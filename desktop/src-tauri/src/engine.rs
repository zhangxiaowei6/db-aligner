//! Owns the Java engine's private stdin/stdout protocol. The renderer never sees this channel.

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fmt,
    fs::{self, OpenOptions},
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tokio::{
    sync::{oneshot, watch},
    time::timeout,
};
use uuid::Uuid;

const READY_TIMEOUT: Duration = Duration::from_secs(60);
const COMPARE_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const NORMAL_STOP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineError(pub String);

impl fmt::Display for EngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for EngineError {}

#[derive(Clone)]
pub struct Engine {
    paths: Arc<EnginePaths>,
    shared: Arc<Shared>,
}

struct EnginePaths {
    root: PathBuf,
    java: PathBuf,
    engine: PathBuf,
}

struct Shared {
    state: Mutex<State>,
    emit: Arc<dyn Fn(Value) + Send + Sync>,
}

#[derive(Default)]
struct State {
    generation: u64,
    process: Option<Process>,
    pending: HashMap<String, oneshot::Sender<Result<Value, EngineError>>>,
    stopping: bool,
    uncertain: bool,
}

struct Process {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    ready_tx: watch::Sender<bool>,
    ready_rx: watch::Receiver<bool>,
    exit_rx: watch::Receiver<Option<bool>>,
}

impl Engine {
    /// `development_repo` selects the project JDK and `engine/target` for local development.
    /// Production resolves the same resources from the Tauri bundle directory.
    pub fn new(
        root: PathBuf,
        resource_dir: PathBuf,
        development_repo: Option<PathBuf>,
        emit: impl Fn(Value) + Send + Sync + 'static,
    ) -> Self {
        let (java, engine) = if let Some(repo) = development_repo {
            (
                repo.join(".tools/jdk/bin/java.exe"),
                repo.join("engine/target"),
            )
        } else {
            (
                resource_dir.join("runtime/bin/java.exe"),
                resource_dir.join("engine"),
            )
        };
        Self::with_paths(root, java, engine, emit)
    }

    pub fn with_paths(
        root: PathBuf,
        java: PathBuf,
        engine: PathBuf,
        emit: impl Fn(Value) + Send + Sync + 'static,
    ) -> Self {
        Self {
            paths: Arc::new(EnginePaths { root, java, engine }),
            shared: Arc::new(Shared {
                state: Mutex::new(State::default()),
                emit: Arc::new(emit),
            }),
        }
    }

    pub fn uncertain(&self) -> bool {
        self.shared.state.lock().unwrap().uncertain
    }

    pub fn is_ready(&self) -> bool {
        let state = self.shared.state.lock().unwrap();
        state
            .process
            .as_ref()
            .is_some_and(|process| *process.ready_rx.borrow())
    }

    /// Waits for the Java `ready` event before accepting the first request.
    pub async fn start(&self) -> Result<(), EngineError> {
        fs::create_dir_all(&self.paths.root).map_err(io_error)?;
        let (generation, ready_rx) = {
            let mut state = self.shared.state.lock().unwrap();
            if let Some(process) = &state.process {
                (state.generation, process.ready_rx.clone())
            } else {
                let mut command = Command::new(&self.paths.java);
                command
                    .arg("-Dfile.encoding=UTF-8")
                    .arg("-cp")
                    .arg(classpath(&self.paths.engine))
                    .arg("io.dbaligner.EngineMain")
                    .env("DB_ALIGNER_HOME", &self.paths.root)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                }
                let mut child = command
                    .spawn()
                    .map_err(|error| EngineError(format!("无法启动 Java 引擎：{error}")))?;
                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| EngineError("Java 引擎未提供标准输入".into()))?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| EngineError("Java 引擎未提供标准输出".into()))?;
                let stderr = child
                    .stderr
                    .take()
                    .ok_or_else(|| EngineError("Java 引擎未提供错误输出".into()))?;
                let child = Arc::new(Mutex::new(child));
                let stdin = Arc::new(Mutex::new(Some(stdin)));
                let (ready_tx, ready_rx) = watch::channel(false);
                let (exit_tx, exit_rx) = watch::channel(None);
                state.generation = state.generation.wrapping_add(1);
                let generation = state.generation;
                state.stopping = false;
                state.process = Some(Process {
                    child: child.clone(),
                    stdin,
                    ready_tx,
                    ready_rx: ready_rx.clone(),
                    exit_rx,
                });
                let shared = self.shared.clone();
                let stdout_thread = thread::Builder::new()
                    .name("dbaligner-engine-stdout".into())
                    .spawn(move || read_stdout(stdout, shared, generation));
                let stdout_thread = match stdout_thread {
                    Ok(handle) => handle,
                    Err(error) => {
                        let _ = child.lock().unwrap().kill();
                        state.process.take();
                        return Err(io_error(error));
                    }
                };
                let root = self.paths.root.clone();
                let stderr_thread = thread::Builder::new()
                    .name("dbaligner-engine-stderr".into())
                    .spawn(move || read_stderr(stderr, root));
                if let Err(error) = stderr_thread {
                    let _ = child.lock().unwrap().kill();
                    state.process.take();
                    return Err(io_error(error));
                }
                let shared = self.shared.clone();
                let monitor = thread::Builder::new()
                    .name("dbaligner-engine-wait".into())
                    .spawn({
                        let child = child.clone();
                        move || watch_child(child, stdout_thread, shared, generation, exit_tx)
                    });
                if let Err(error) = monitor {
                    let _ = child.lock().unwrap().kill();
                    state.process.take();
                    return Err(io_error(error));
                }
                (generation, ready_rx)
            }
        };
        match timeout(READY_TIMEOUT, wait_ready(ready_rx)).await {
            Ok(result) => result,
            Err(_) => {
                // No business request can be in flight before readiness. Close the stalled
                // startup instead of leaving an orphan process behind.
                let still_current = self.shared.state.lock().unwrap().generation == generation;
                if still_current {
                    let _ = self.stop().await;
                }
                Err(EngineError("Java 引擎启动超时，请查看诊断日志".into()))
            }
        }
    }

    /// Sends one ordinary request. The caller must enforce the renderer method allowlist.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, EngineError> {
        if !params.is_object() {
            return Err(EngineError("请求参数必须是对象".into()));
        }
        let (generation, ready_rx) = {
            let state = self.shared.state.lock().unwrap();
            let process = state
                .process
                .as_ref()
                .ok_or_else(|| EngineError("Java 引擎尚未启动".into()))?;
            (state.generation, process.ready_rx.clone())
        };
        match timeout(READY_TIMEOUT, wait_ready(ready_rx)).await {
            Ok(result) => result?,
            Err(_) => return Err(EngineError("Java 引擎启动超时，请查看诊断日志".into())),
        }
        let id = Uuid::new_v4().to_string();
        let mut line = serde_json::to_vec(&json!({ "id": id, "method": method, "params": params }))
            .map_err(|error| EngineError(error.to_string()))?;
        line.push(b'\n');
        let (response_tx, response_rx) = oneshot::channel();
        let stdin = {
            let mut state = self.shared.state.lock().unwrap();
            if state.generation != generation || state.stopping {
                return Err(EngineError("Java 引擎已关闭".into()));
            }
            let stdin = state
                .process
                .as_ref()
                .ok_or_else(|| EngineError("Java 引擎已关闭".into()))?
                .stdin
                .clone();
            state.pending.insert(id.clone(), response_tx);
            stdin
        };
        arm_timeout(
            self.shared.clone(),
            generation,
            id.clone(),
            request_timeout(method),
        );
        let write_result = {
            let mut guard = stdin.lock().unwrap();
            match guard.as_mut() {
                Some(stream) => stream.write_all(&line),
                None => Err(io::Error::new(io::ErrorKind::BrokenPipe, "stdin closed")),
            }
        };
        if let Err(error) = write_result {
            let mut state = self.shared.state.lock().unwrap();
            state.pending.remove(&id);
            state.uncertain = true; // A partial line may already have reached Java.
            return Err(EngineError(format!("Java 引擎通信失败：{error}")));
        }
        response_rx
            .await
            .unwrap_or_else(|_| Err(EngineError("Java 引擎退出，未完成任务需核验".into())))
    }

    /// Normal application shutdown may terminate a process that ignores closed stdin.
    pub async fn stop(&self) -> Result<(), EngineError> {
        let Some((child, stdin, exit_rx)) = self.stop_handles() else {
            return Ok(());
        };
        stdin.lock().unwrap().take();
        match timeout(NORMAL_STOP_TIMEOUT, wait_exit(exit_rx.clone())).await {
            Ok(result) => {
                result?;
            }
            Err(_) => {
                // The ordinary close path may terminate a stuck engine. A process that
                // exited while stdout was draining can make kill fail harmlessly.
                let _ = child.lock().unwrap().kill();
                timeout(NORMAL_STOP_TIMEOUT, wait_exit(exit_rx))
                    .await
                    .map_err(|_| EngineError("无法确认 Java 引擎退出状态".into()))??;
            }
        }
        Ok(())
    }

    /// Update installation must observe a clean Java exit and must never kill it.
    pub async fn stop_for_update(&self) -> Result<(), EngineError> {
        let (_, stdin, exit_rx) = self
            .stop_handles()
            .ok_or_else(|| EngineError("Java 引擎已关闭".into()))?;
        stdin.lock().unwrap().take();
        if wait_exit(exit_rx).await? {
            Ok(())
        } else {
            Err(EngineError("引擎未正常退出，不能安装更新".into()))
        }
    }

    fn stop_handles(
        &self,
    ) -> Option<(
        Arc<Mutex<Child>>,
        Arc<Mutex<Option<ChildStdin>>>,
        watch::Receiver<Option<bool>>,
    )> {
        let mut state = self.shared.state.lock().unwrap();
        let Some(process) = state.process.as_ref() else {
            return None;
        };
        let handles = (
            process.child.clone(),
            process.stdin.clone(),
            process.exit_rx.clone(),
        );
        state.stopping = true;
        Some(handles)
    }
}

fn classpath(engine: &Path) -> String {
    let separator = if cfg!(windows) { ';' } else { ':' };
    format!(
        "{}{}{}",
        java_classpath_path(&engine.join("engine.jar")),
        separator,
        java_classpath_path(&engine.join("lib/*"))
    )
}

fn java_classpath_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        // Tauri's resource_dir can use a Win32 verbatim path. Java's classpath
        // parser does not recognize that prefix, even when the JAR exists.
        if let Some(path) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{path}");
        }
        if let Some(path) = value.strip_prefix(r"\\?\") {
            return path.to_string();
        }
    }
    value.into_owned()
}

fn request_timeout(method: &str) -> Duration {
    match method {
        "sync.compare.start" | "sync.compare.get" | "sync.compare.cancel" => COMPARE_TIMEOUT,
        _ => REQUEST_TIMEOUT,
    }
}

fn io_error(error: io::Error) -> EngineError {
    EngineError(error.to_string())
}

async fn wait_ready(mut rx: watch::Receiver<bool>) -> Result<(), EngineError> {
    while !*rx.borrow() {
        rx.changed()
            .await
            .map_err(|_| EngineError("Java 引擎退出，未完成任务需核验".into()))?;
    }
    Ok(())
}

async fn wait_exit(mut rx: watch::Receiver<Option<bool>>) -> Result<bool, EngineError> {
    loop {
        if let Some(success) = *rx.borrow() {
            return Ok(success);
        }
        rx.changed()
            .await
            .map_err(|_| EngineError("无法确认 Java 引擎退出状态".into()))?;
    }
}

fn arm_timeout(shared: Arc<Shared>, generation: u64, id: String, duration: Duration) {
    // This watchdog outlives a renderer invocation that is abandoned by navigation.
    // A timeout cannot silently disappear and allow an unsafe update installation.
    tokio::spawn(async move {
        tokio::time::sleep(duration).await;
        let pending = {
            let mut state = shared.state.lock().unwrap();
            if state.generation != generation {
                return;
            }
            let pending = state.pending.remove(&id);
            if pending.is_some() {
                state.uncertain = true;
            }
            pending
        };
        if let Some(sender) = pending {
            let _ = sender.send(Err(EngineError(
                "请求超时；执行任务不会因此自动撤销，请查看记录".into(),
            )));
        }
    });
}

fn read_stdout(stdout: impl io::Read, shared: Arc<Shared>, generation: u64) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut line = Vec::new();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                if let Ok(text) = std::str::from_utf8(&line) {
                    shared.handle_line(generation, text);
                }
            }
        }
    }
}

fn read_stderr(stderr: impl io::Read, root: PathBuf) {
    let mut reader = BufReader::new(stderr);
    let destination = OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("engine.log"));
    if let Ok(mut log) = destination {
        let _ = io::copy(&mut reader, &mut log);
    } else {
        let _ = io::copy(&mut reader, &mut io::sink());
    }
}

fn watch_child(
    child: Arc<Mutex<Child>>,
    stdout_thread: thread::JoinHandle<()>,
    shared: Arc<Shared>,
    generation: u64,
    exit_tx: watch::Sender<Option<bool>>,
) {
    let status: io::Result<ExitStatus> = loop {
        match child.lock().unwrap().try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => break Err(error),
        }
    };
    // Deliver any complete response already buffered on stdout before rejecting the rest.
    let _ = stdout_thread.join();
    let success = status.as_ref().is_ok_and(ExitStatus::success);
    shared.finish_exit(generation);
    let _ = exit_tx.send(Some(success));
}

impl Shared {
    fn handle_line(&self, generation: u64, line: &str) {
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return; // stdout is reserved for protocol messages; malformed lines are never shown.
        };
        if message.get("event").and_then(Value::as_str) == Some("ready") {
            let mut state = self.state.lock().unwrap();
            if state.generation == generation {
                if let Some(process) = &state.process {
                    let _ = process.ready_tx.send(true);
                    state.uncertain = false;
                }
            }
            return;
        }
        if message.get("event").is_some() {
            let is_current = self.state.lock().unwrap().generation == generation;
            if is_current {
                (self.emit)(message);
            }
            return;
        }
        let Some(id) = message.get("id").and_then(Value::as_str) else {
            return;
        };
        let pending = {
            let mut state = self.state.lock().unwrap();
            if state.generation != generation {
                return;
            }
            state.pending.remove(id)
        };
        if let Some(sender) = pending {
            let result = if let Some(error) = message.get("error") {
                Err(EngineError(
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Java 引擎请求失败")
                        .to_owned(),
                ))
            } else {
                Ok(message.get("result").cloned().unwrap_or(Value::Null))
            };
            let _ = sender.send(result);
        }
    }

    fn finish_exit(&self, generation: u64) {
        let (pending, unexpected, message) = {
            let mut state = self.state.lock().unwrap();
            if state.generation != generation {
                return;
            }
            let unexpected = !state.stopping;
            if unexpected {
                state.uncertain = true;
            }
            state.process.take();
            state.stopping = false;
            let message = if unexpected {
                "Java 引擎退出，未完成任务需核验"
            } else {
                "引擎已关闭"
            };
            (std::mem::take(&mut state.pending), unexpected, message)
        };
        for (_, sender) in pending {
            let _ = sender.send(Err(EngineError(message.into())));
        }
        if unexpected {
            (self.emit)(json!({ "event": "engine-error", "message": message }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn classpath_removes_verbatim_drive_prefix_from_both_entries() {
        let path = Path::new(r"\\?\D:\Program Files\DBAligner\engine");
        assert_eq!(
            classpath(path),
            r"D:\Program Files\DBAligner\engine\engine.jar;D:\Program Files\DBAligner\engine\lib\*"
        );
    }

    #[cfg(windows)]
    #[test]
    fn classpath_converts_verbatim_unc_to_ordinary_unc() {
        let path = Path::new(r"\\?\UNC\server\share\DBAligner\engine");
        assert_eq!(
            classpath(path),
            r"\\server\share\DBAligner\engine\engine.jar;\\server\share\DBAligner\engine\lib\*"
        );
    }

    fn fixture() -> (Engine, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let received = events.clone();
        let engine = Engine::with_paths(
            PathBuf::new(),
            PathBuf::new(),
            PathBuf::new(),
            move |event| received.lock().unwrap().push(event),
        );
        engine.shared.state.lock().unwrap().generation = 1;
        (engine, events)
    }

    #[tokio::test]
    async fn routes_concurrent_responses_by_id_and_keeps_utf8_events() {
        let (engine, events) = fixture();
        let (first_tx, first_rx) = oneshot::channel();
        let (second_tx, second_rx) = oneshot::channel();
        {
            let mut state = engine.shared.state.lock().unwrap();
            state.pending.insert("first".into(), first_tx);
            state.pending.insert("second".into(), second_tx);
        }
        engine.shared.handle_line(1, "not json");
        engine.shared.handle_line(
            1,
            r#"{"event":"compare-progress","compareId":"比较一","progress":42}"#,
        );
        engine.shared.handle_line(
            1,
            r#"{"id":"second","result":{"label":"中文","amount":"1234567890.123456789"}}"#,
        );
        engine
            .shared
            .handle_line(1, r#"{"id":"first","result":{"ok":true}}"#);
        assert_eq!(first_rx.await.unwrap().unwrap(), json!({ "ok": true }));
        assert_eq!(
            second_rx.await.unwrap().unwrap(),
            json!({ "label": "中文", "amount": "1234567890.123456789" })
        );
        assert_eq!(
            events.lock().unwrap().as_slice(),
            &[json!({"event":"compare-progress","compareId":"比较一","progress":42})]
        );
    }

    #[tokio::test]
    async fn timeout_marks_result_unknown_and_ignores_late_reply() {
        let (engine, _) = fixture();
        let (sender, receiver) = oneshot::channel();
        engine
            .shared
            .state
            .lock()
            .unwrap()
            .pending
            .insert("slow".into(), sender);
        arm_timeout(
            engine.shared.clone(),
            1,
            "slow".into(),
            Duration::from_millis(10),
        );
        let error = receiver.await.unwrap().unwrap_err();
        assert!(error.0.contains("不会因此自动撤销"));
        assert!(engine.uncertain());
        engine
            .shared
            .handle_line(1, r#"{"id":"slow","result":{"ok":true}}"#);
        assert!(engine.shared.state.lock().unwrap().pending.is_empty());
        assert_eq!(
            request_timeout("sync.compare.cancel"),
            Duration::from_secs(15)
        );
        assert_eq!(request_timeout("sync.save"), Duration::from_secs(1800));
    }

    #[tokio::test]
    async fn abandoned_caller_does_not_cancel_unknown_result_watchdog() {
        let (engine, _) = fixture();
        let (sender, receiver) = oneshot::channel();
        engine
            .shared
            .state
            .lock()
            .unwrap()
            .pending
            .insert("abandoned".into(), sender);
        arm_timeout(
            engine.shared.clone(),
            1,
            "abandoned".into(),
            Duration::from_millis(10),
        );
        drop(receiver);
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(engine.uncertain());
        assert!(engine.shared.state.lock().unwrap().pending.is_empty());
    }

    #[tokio::test]
    async fn unexpected_exit_rejects_pending_and_notifies_renderer() {
        let (engine, events) = fixture();
        let (sender, receiver) = oneshot::channel();
        engine
            .shared
            .state
            .lock()
            .unwrap()
            .pending
            .insert("running".into(), sender);
        engine.shared.finish_exit(1);
        assert!(receiver.await.unwrap().unwrap_err().0.contains("需核验"));
        assert!(engine.uncertain());
        assert_eq!(
            events.lock().unwrap().as_slice(),
            &[json!({"event":"engine-error","message":"Java 引擎退出，未完成任务需核验"})]
        );
    }

    #[tokio::test]
    #[ignore = "requires a built engine and the project Java runtime"]
    async fn real_java_engine_uses_one_line_json_and_graceful_exit() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let root = std::env::temp_dir().join(format!("dbaligner-engine-test-{}", Uuid::new_v4()));
        let engine = Engine::new(root.clone(), PathBuf::new(), Some(repo), |_| {});
        engine.start().await.unwrap();
        let (ping, state) = tokio::join!(
            engine.call("ping", json!({})),
            engine.call("state.load", json!({}))
        );
        assert_eq!(ping.unwrap()["protocol"], 1);
        assert!(state.unwrap()["workspaces"].is_array());
        engine.stop_for_update().await.unwrap();
        assert!(!engine.is_ready());
        assert!(!engine.uncertain());
        assert!(root.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(root).unwrap();
    }
}

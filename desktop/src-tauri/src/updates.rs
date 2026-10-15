//! Signed Tauri installer updates with the same task admission barrier as the desktop host.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex as AsyncMutex;

use crate::engine::Engine;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    version: String,
    enabled: bool,
    revision: u64,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<f64>,
    message: String,
}

pub struct Updates {
    app: AppHandle,
    state: Mutex<UpdateState>,
    operation: AsyncMutex<()>,
    candidate: Mutex<Option<Update>>,
    archive: Mutex<Option<Vec<u8>>>,
}

impl Updates {
    pub fn new(app: AppHandle, enabled: bool) -> Self {
        let version = app.package_info().version.to_string();
        Self {
            app,
            state: Mutex::new(UpdateState {
                version,
                enabled,
                revision: 0,
                status: if enabled { "idle" } else { "disabled" }.into(),
                next_version: None,
                percent: None,
                message: if enabled {
                    "尚未检查更新"
                } else {
                    "当前运行方式不支持自动更新，请使用正式安装版"
                }
                .into(),
            }),
            operation: AsyncMutex::new(()),
            candidate: Mutex::new(None),
            archive: Mutex::new(None),
        }
    }

    pub fn get(&self) -> Value {
        serde_json::to_value(self.state.lock().unwrap().clone()).unwrap_or(Value::Null)
    }

    fn set(
        &self,
        status: &str,
        next_version: Option<String>,
        percent: Option<f64>,
        message: impl Into<String>,
    ) -> Value {
        let state = {
            let mut state = self.state.lock().unwrap();
            state.revision += 1;
            state.status = status.into();
            state.next_version = next_version;
            state.percent = percent;
            state.message = message.into();
            state.clone()
        };
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.emit(
                "dbaligner:event",
                json!({"event": "update-state", "state": state}),
            );
        }
        serde_json::to_value(state).unwrap_or(Value::Null)
    }

    pub async fn check(&self) -> Value {
        if !self.state.lock().unwrap().enabled {
            return self.get();
        }
        let _operation = self.operation.lock().await;
        let status = self.state.lock().unwrap().status.clone();
        if ["downloading", "downloaded", "installing"].contains(&status.as_str()) {
            return self.get();
        }
        self.set("checking", None, None, "正在检查更新");
        let result = match self.app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => return self.set("error", None, None, format!("无法检查更新：{error}")),
        };
        match result {
            Ok(Some(update))
                if newer_stable(&update.version, &self.state.lock().unwrap().version) =>
            {
                let version = update.version.clone();
                *self.candidate.lock().unwrap() = Some(update);
                self.set("available", Some(version), None, "发现新版本，可确认下载")
            }
            Ok(_) => {
                *self.candidate.lock().unwrap() = None;
                self.set("current", None, None, "当前已是最新正式版本")
            }
            Err(_) => self.set("error", None, None, "无法检查更新，请检查网络或稍后重试"),
        }
    }

    pub async fn download(&self) -> Result<Value, String> {
        let _operation = self.operation.lock().await;
        let (status, version) = {
            let state = self.state.lock().unwrap();
            (state.status.clone(), state.next_version.clone())
        };
        if status != "available" {
            return Err("请先检查并发现新版本".into());
        }
        let update = self
            .candidate
            .lock()
            .unwrap()
            .clone()
            .ok_or("更新资料已过期，请重新检查")?;
        self.set("downloading", version.clone(), Some(0.0), "正在下载更新");
        let mut downloaded = 0_u64;
        let result = update
            .download(
                |chunk, total| {
                    downloaded += chunk as u64;
                    if let Some(total) = total.filter(|total| *total > 0) {
                        let percent =
                            ((downloaded as f64 / total as f64) * 100.0).clamp(0.0, 100.0);
                        self.set(
                            "downloading",
                            version.clone(),
                            Some(percent),
                            "正在下载更新",
                        );
                    }
                },
                || {},
            )
            .await;
        match result {
            Ok(bytes) => {
                *self.archive.lock().unwrap() = Some(bytes);
                Ok(self.set(
                    "downloaded",
                    version,
                    Some(100.0),
                    "下载完成，任务结束后可确认重启安装",
                ))
            }
            Err(_) => Ok(self.set(
                "error",
                version,
                None,
                "更新下载或校验失败，请重新检查后重试",
            )),
        }
    }

    pub async fn install(
        &self,
        engine: &Engine,
        active_requests: &AtomicUsize,
        frozen: &AtomicBool,
    ) -> Result<Value, String> {
        let _operation = self.operation.lock().await;
        let version = {
            let state = self.state.lock().unwrap();
            if state.status != "downloaded" {
                return Err("请先下载并校验更新".into());
            }
            state.next_version.clone()
        };
        if frozen.swap(true, Ordering::SeqCst) {
            return Err("已经在准备更新".into());
        }
        self.set(
            "installing",
            version.clone(),
            Some(100.0),
            "正在确认任务状态并准备安装",
        );
        let mut prepared = false;
        let result = async {
            if active_requests.load(Ordering::SeqCst) > 0 || engine.uncertain() {
                return Err(
                    "仍有请求正在处理或结果尚未确认，请稍后重试；状态不明时需重新启动客户端"
                        .to_owned(),
                );
            }
            let result = engine
                .call("engine.prepareUpdate", json!({}))
                .await
                .map_err(|error| error.0)?;
            if result.get("prepared").and_then(Value::as_bool) != Some(true) {
                return Err("引擎未确认可以更新".into());
            }
            prepared = true;
            engine.stop_for_update().await.map_err(|error| error.0)?;
            let candidate = self
                .candidate
                .lock()
                .unwrap()
                .clone()
                .ok_or("更新资料已过期，请重新检查")?;
            let archive = self
                .archive
                .lock()
                .unwrap()
                .take()
                .ok_or("更新资料已过期，请重新下载")?;
            // On Windows this launches the signed NSIS installer and exits the app.
            candidate
                .install(&archive)
                .map_err(|error| error.to_string())?;
            Ok::<(), String>(())
        }
        .await;
        if let Err(error) = result {
            let recovered = if engine.is_ready() {
                if prepared {
                    engine
                        .call("engine.resumeUpdate", json!({}))
                        .await
                        .map(|_| ())
                        .map_err(|error| error.0)
                } else {
                    Ok(())
                }
            } else {
                engine.start().await.map_err(|error| error.0)
            };
            if recovered.is_err() {
                self.set(
                    "error",
                    version,
                    None,
                    "更新准备失败，暂时无法恢复引擎；请重新启动客户端",
                );
                return Err("更新准备失败，暂时无法恢复引擎；请重新启动客户端".into());
            }
            frozen.store(false, Ordering::SeqCst);
            self.set("downloaded", version, Some(100.0), error.clone());
            return Err(error);
        }
        Ok(self.get())
    }
}

fn newer_stable(candidate: &str, current: &str) -> bool {
    fn parts(value: &str) -> Option<[u64; 3]> {
        let segments: Vec<_> = value.split('.').collect();
        if segments.len() != 3
            || segments.iter().any(|part| {
                part.is_empty()
                    || (part.len() > 1 && part.starts_with('0'))
                    || !part.bytes().all(|ch| ch.is_ascii_digit())
            })
        {
            return None;
        }
        Some([
            segments[0].parse().ok()?,
            segments[1].parse().ok()?,
            segments[2].parse().ok()?,
        ])
    }
    matches!((parts(candidate), parts(current)), (Some(next), Some(old)) if next > old)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_only_accepts_newer_stable_versions() {
        assert!(newer_stable("0.1.1", "0.1.0"));
        assert!(!newer_stable("0.1.0", "0.1.0"));
        assert!(!newer_stable("0.0.9", "0.1.0"));
        assert!(!newer_stable("0.2.0-beta.1", "0.1.0"));
    }
}

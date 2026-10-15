//! Isolated packaged-client regression used by the database integration tests.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::host::Host;

pub fn fixture_path() -> Result<Option<PathBuf>, String> {
    let mut smoke = false;
    let mut fixture = None;
    for argument in std::env::args().skip(1) {
        if argument == "--smoke-test" {
            smoke = true;
        } else if let Some(path) = argument.strip_prefix("--smoke-fixture=") {
            fixture = Some(PathBuf::from(path));
        }
    }
    if !smoke {
        return Ok(None);
    }
    let root = std::env::var_os("DB_ALIGNER_HOME").ok_or("打包验收必须指定隔离资料目录")?;
    let root = PathBuf::from(root);
    if !root.is_absolute() {
        return Err("打包验收资料目录必须是绝对路径".into());
    }
    let fixture = fixture.ok_or("打包验收缺少 --smoke-fixture")?;
    if !fixture.is_absolute() || !fixture.is_file() {
        return Err("打包验收资料无效".into());
    }
    Ok(Some(fixture))
}

async fn call(
    app: &AppHandle,
    window: &WebviewWindow,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    app.state::<Host>()
        .invoke(app, window, method, params)
        .await
}

fn checked(condition: bool, label: &str, checks: &mut Vec<String>) -> Result<(), String> {
    if !condition {
        return Err(label.to_owned());
    }
    checks.push(label.to_owned());
    Ok(())
}

pub async fn run(
    app: &AppHandle,
    window: &WebviewWindow,
    fixture_path: &Path,
    root: &Path,
) -> Result<Vec<String>, String> {
    let fixture: Value =
        serde_json::from_slice(&fs::read(fixture_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let mut checks = Vec::new();
    let password = fixture["password"].as_str().ok_or("验收凭据缺失")?;
    let source_database = fixture["source"].as_str().ok_or("源库缺失")?;
    let target_database = fixture["target"].as_str().ok_or("目标库缺失")?;
    let table = fixture["table"].as_str().ok_or("验收表缺失")?;
    let ping = call(app, window, "ping", json!({})).await?;
    checked(ping["protocol"] == 1, "真实随包 Java 引擎协议", &mut checks)?;
    let update = call(app, window, "updates.get", json!({})).await?;
    checked(
        update["enabled"] == false,
        "打包验收不访问更新网络",
        &mut checks,
    )?;
    checked(
        call(app, window, "engine.prepareUpdate", json!({}))
            .await
            .is_err(),
        "内部更新接口未暴露",
        &mut checks,
    )?;
    checked(
        call(
            app,
            window,
            "updates.check",
            json!({"url":"https://example.invalid"}),
        )
        .await
        .is_err(),
        "渲染进程不能更改更新源",
        &mut checks,
    )?;
    let drivers = call(app, window, "drivers.list", json!({})).await?;
    checked(
        drivers.as_array().is_some_and(|items| {
            items
                .iter()
                .any(|item| item["id"] == "mariadb" && item["status"] == "installed")
        }),
        "内置 MySQL 驱动离线可用",
        &mut checks,
    )?;
    checked(
        call(
            app,
            window,
            "drivers.install",
            json!({"driverId":"postgresql","url":"https://example.invalid"}),
        )
        .await
        .is_err(),
        "渲染进程不能更改驱动目录",
        &mut checks,
    )?;
    if fixture["connection"]["databaseType"] == "postgresql" {
        let before = call(app, window, "drivers.get", json!({"driverId":"postgresql"})).await?;
        let expected = if fixture["expectCachedDriver"] == true {
            "installed"
        } else {
            "missing"
        };
        checked(
            before["status"] == expected,
            "PostgreSQL 驱动缓存状态",
            &mut checks,
        )?;
        let installed = call(
            app,
            window,
            "drivers.install",
            json!({"driverId":"postgresql"}),
        )
        .await?;
        checked(
            installed["status"] == "installed",
            "固定版本 PostgreSQL 驱动安装或复用",
            &mut checks,
        )?;
    }
    let mut connection = fixture["connection"]
        .as_object()
        .ok_or("连接资料无效")?
        .clone();
    connection.insert("id".into(), json!("smoke-connection"));
    connection.insert("name".into(), json!("Release verification"));
    connection.insert("workspaceIds".into(), json!(["default"]));
    connection.insert("password".into(), json!(password));
    call(
        app,
        window,
        "entity.save",
        json!({"kind":"connection","value":connection}),
    )
    .await?;
    let state = call(app, window, "state.load", json!({})).await?;
    checked(
        !state.to_string().contains(password),
        "界面状态不含明文密码",
        &mut checks,
    )?;
    let imported = call(app, window, "imports.parse", json!({"format":"dbeaver","content":json!({"connections":{"test":{"name":"Import verification","provider":"mysql","configuration":{"host":"127.0.0.1","port":"3306","user":"root","password":password,"database":source_database}}}}).to_string()})).await?;
    checked(
        !imported.to_string().contains(password),
        "导入凭据留在宿主",
        &mut checks,
    )?;
    let encrypted =
        fs::read_to_string(root.join("credentials.json")).map_err(|error| error.to_string())?;
    checked(
        !encrypted.contains(password),
        "Windows 系统加密密码文件",
        &mut checks,
    )?;
    let connected = call(
        app,
        window,
        "connections.test",
        json!({"id":"smoke-connection"}),
    )
    .await?;
    checked(connected["ok"] == true, "真实随包 JDBC 连接", &mut checks)?;
    let mut source = json!({"connectionId":"smoke-connection","database":source_database});
    let mut target = json!({"connectionId":"smoke-connection","database":target_database});
    if let Some(schema) = fixture["sourceSchema"].as_str() {
        source["schema"] = json!(schema);
        target["schema"] = fixture["targetSchema"].clone();
        let schemas = call(app, window, "schemas.list", json!({"ref":source})).await?;
        checked(
            schemas.as_array().is_some_and(|items| {
                items.iter().any(|item| item == schema)
                    && items.iter().any(|item| item == &fixture["targetSchema"])
            }),
            "随包 schema 命名空间发现",
            &mut checks,
        )?;
    }
    if fixture.get("mysql").is_some() {
        let mut mysql = fixture["mysql"]
            .as_object()
            .ok_or("双驱动连接无效")?
            .clone();
        mysql.insert("id".into(), json!("mysql-control"));
        mysql.insert("name".into(), json!("双驱动验证"));
        mysql.insert("workspaceIds".into(), json!(["default"]));
        call(
            app,
            window,
            "entity.save",
            json!({"kind":"connection","value":mysql}),
        )
        .await?;
        let mysql_connected = call(
            app,
            window,
            "connections.test",
            json!({"id":"mysql-control"}),
        )
        .await?;
        checked(
            mysql_connected["ok"] == true,
            "同一客户端双 JDBC 驱动",
            &mut checks,
        )?;
    }
    let plan = call(app, window, "sync.compare", json!({"workspaceId":"default","source":source,"targets":[target],"tables":[{"name":table,"structure":false,"data":true,"keyColumns":[]}]})).await?;
    let changes: Vec<Value> = plan["targets"]
        .as_array()
        .ok_or("比较目标无效")?
        .iter()
        .flat_map(|target| target["changes"].as_array().cloned().unwrap_or_default())
        .collect();
    if let Some(big_id) = fixture["bigId"].as_str() {
        checked(
            changes.iter().any(|change| {
                change["after"]["id"] == big_id && change["after"]["amount"] == fixture["amount"]
            }),
            "BIGINT 与 DECIMAL 经协议精确展示",
            &mut checks,
        )?;
    }
    let selected: Vec<Value> = changes
        .iter()
        .filter(|change| change["blocked"] != true)
        .filter_map(|change| change.get("id").cloned())
        .collect();
    checked(!selected.is_empty(), "真实引擎比较", &mut checks)?;
    let saved = call(app, window, "sync.save", json!({"planId":plan["id"],"selectedIds":selected,"mode":"SAVE_ONLY","remark":"Packaged validation"})).await?;
    checked(saved["status"] == "UNEXECUTED", "仅保存记录", &mut checks)?;
    let executed = call(app, window, "sync.save", json!({"planId":plan["id"],"selectedIds":selected,"mode":"EXECUTE_AND_SAVE","remark":"Packaged validation"})).await?;
    let mut record = Value::Null;
    for _ in 0..300 {
        let detail = call(app, window, "record.get", json!({"id":executed["id"]})).await?;
        record = detail["record"].clone();
        if record["status"] != "RUNNING" && record["status"] != "QUEUED" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    checked(
        record["status"] == "SUCCESS",
        "打包客户端执行与归档",
        &mut checks,
    )?;
    let preview = call(
        app,
        window,
        "rollback.preview",
        json!({"id":executed["id"]}),
    )
    .await?;
    let items = preview["items"].as_array().ok_or("回滚预览无效")?;
    checked(
        items.len() == selected.len() && items.iter().all(|item| item["eligible"] == true),
        "恢复资料已核验",
        &mut checks,
    )?;
    let rolled = call(app, window, "rollback.execute", json!({"id":executed["id"],"selectedIds":items.iter().map(|item| item["id"].clone()).collect::<Vec<_>>(),"remark":"Packaged validation"})).await?;
    checked(rolled["status"] == "SUCCESS", "打包客户端回滚", &mut checks)?;
    let export = call(
        app,
        window,
        "schema.export",
        json!({"source":source,"tables":[table],"includeDrop":false}),
    )
    .await?;
    checked(
        !export["sql"]
            .as_str()
            .unwrap_or("")
            .contains("\nDROP TABLE")
            && export["sql"].as_str().unwrap_or("").contains(table),
        "中文对象结构导出默认无 DROP",
        &mut checks,
    )?;
    let export_drop = call(
        app,
        window,
        "schema.export",
        json!({"source":source,"tables":[table],"includeDrop":true}),
    )
    .await?;
    checked(
        export_drop["sql"]
            .as_str()
            .unwrap_or("")
            .contains("DROP TABLE IF EXISTS"),
        "显式 DROP 导出",
        &mut checks,
    )?;
    let detail = call(app, window, "record.get", json!({"id":saved["id"]})).await?;
    checked(
        detail["files"].as_array().is_some_and(|files| {
            files.iter().any(|file| {
                file.as_str()
                    .is_some_and(|name| name.ends_with("02_sync.sql"))
            })
        }),
        "本地档案与逆向资料",
        &mut checks,
    )?;
    Ok(checks)
}

pub fn write_result(root: &Path, outcome: Result<Vec<String>, String>) -> bool {
    let (passed, report) = match outcome {
        Ok(checks) => (
            true,
            json!({"passed":true,"checks":checks,"at":timestamp()}),
        ),
        Err(message) => (
            false,
            json!({"passed":false,"error":message,"at":timestamp()}),
        ),
    };
    let _ = fs::write(
        root.join("smoke-result.json"),
        serde_json::to_vec_pretty(&report).unwrap_or_default(),
    );
    passed
}

fn timestamp() -> String {
    format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    )
}

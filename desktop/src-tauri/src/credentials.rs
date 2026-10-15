use std::collections::BTreeMap;
use std::ffi::c_void;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::ptr;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use uuid::Uuid;
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

/// Password material belongs to the Windows user profile and is never sent to the webview.
pub struct Credentials {
    path: PathBuf,
    encrypted: BTreeMap<String, String>,
}

impl Credentials {
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = root.join("credentials.json");
        let encrypted = match File::open(&path) {
            Ok(mut file) => {
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)
                    .map_err(|error| format!("读取系统凭据失败：{error}"))?;
                serde_json::from_slice(&bytes)
                    .map_err(|error| format!("系统凭据文件损坏，请先保留原文件：{error}"))?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(format!("读取系统凭据失败：{error}")),
        };
        Ok(Self { path, encrypted })
    }

    pub fn snapshot(&self) -> BTreeMap<String, String> {
        self.encrypted.clone()
    }

    pub fn decrypted(&self) -> BTreeMap<String, String> {
        self.encrypted
            .iter()
            .filter_map(|(id, ciphertext)| {
                decrypt(ciphertext)
                    .ok()
                    .map(|plaintext| (id.clone(), plaintext))
            })
            .collect()
    }

    /// Commit a staged map only after the matching Java request succeeds.
    pub fn replace(&mut self, next: BTreeMap<String, String>) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "系统凭据目录无效".to_owned())?;
        fs::create_dir_all(parent).map_err(|error| format!("创建凭据目录失败：{error}"))?;
        let temporary = parent.join(format!(".credentials-{}.tmp", Uuid::new_v4()));
        let write_result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| format!("写入凭据暂存文件失败：{error}"))?;
            serde_json::to_writer(&mut file, &next)
                .map_err(|error| format!("序列化凭据失败：{error}"))?;
            file.flush()
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("持久化凭据失败：{error}"))?;
            drop(file);
            fs::rename(&temporary, &self.path)
                .map_err(|error| format!("保存系统凭据失败：{error}"))?;
            Ok::<(), String>(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result?;
        self.encrypted = next;
        Ok(())
    }
}

pub fn encrypt(plaintext: &str) -> Result<String, String> {
    let bytes = plaintext.as_bytes();
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(|_| "密码过长".to_owned())?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let result = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err(format!(
            "Windows 系统加密不可用：{}",
            std::io::Error::last_os_error()
        ));
    }
    let encrypted = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let encoded = STANDARD.encode(encrypted);
    unsafe { LocalFree(output.pbData.cast::<c_void>()) };
    Ok(encoded)
}

fn decrypt(ciphertext: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(ciphertext)
        .map_err(|_| "系统凭据编码无效".to_owned())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(|_| "系统凭据过长".to_owned())?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let result = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err("系统凭据已无法解密，请重新填写密码".to_owned());
    }
    let plaintext = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let decoded =
        String::from_utf8(plaintext.to_vec()).map_err(|_| "系统凭据文本编码无效".to_owned());
    unsafe { LocalFree(output.pbData.cast::<c_void>()) };
    decoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_user_protection_and_atomic_storage() {
        let directory = std::env::current_dir()
            .expect("workspace")
            .join(".local-data")
            .join(format!("dbaligner-credentials-{}", Uuid::new_v4()));
        let mut credentials = Credentials::load(&directory).expect("load empty store");
        let mut staged = credentials.snapshot();
        staged.insert(
            "connection-1".into(),
            encrypt("密码 with Unicode").expect("encrypt"),
        );
        credentials.replace(staged).expect("save");
        let on_disk =
            fs::read_to_string(directory.join("credentials.json")).expect("read ciphertext");
        assert!(!on_disk.contains("密码 with Unicode"));
        let reloaded = Credentials::load(&directory).expect("reload");
        assert_eq!(
            reloaded.decrypted().get("connection-1").map(String::as_str),
            Some("密码 with Unicode")
        );
        fs::remove_dir_all(directory).expect("clean isolated store");
    }
}

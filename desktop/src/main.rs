// Moneta desktop: janela nativa (Tauri) sobre o servidor local do Moneta.
//
// - Sobe o servidor Node.js escondido (no Windows, sem janela de terminal) ou usa o que já estiver
//   rodando, por exemplo o serviço do systemd no Linux.
// - Abre o painel já autorizado pela chave de acesso, numa janela própria em vez do navegador.
// - No Windows, fechar a janela deixa o Moneta na bandeja, sincronizando; "Encerrar" grava o cofre
//   e desliga o servidor.
// - Só uma instância: abrir de novo (pelo menu, por atalho ou pela Ayla) mostra a janela existente.
//
// Uso: moneta [--background]
//   --background  sobe o servidor e fica só na bandeja, sem abrir a janela (início com o Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const WINDOW: &str = "principal";

fn port() -> u16 {
    std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(4173)
}
fn base_url() -> String {
    format!("http://127.0.0.1:{}", port())
}

// Mesma pasta de dados que o server.mjs usa no modo de desktop.
fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("MONETA_DATA_DIR") {
        return PathBuf::from(dir);
    }
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("AppData").join("Local")
        });
        return local.join("Moneta");
    }
    let share = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local").join("share")
    });
    share.join("moneta")
}

fn access_key() -> Option<String> {
    let key = std::fs::read_to_string(data_dir().join("acesso.key")).ok()?;
    let key = key.trim().to_string();
    (key.len() == 43 && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then_some(key)
}

// HTTP mínimo para conversar com o servidor local, sem dependências.
fn request(method: &str, path: &str, key: Option<&str>) -> Option<(u16, String)> {
    let address: SocketAddr = ([127, 0, 0, 1], port()).into();
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(800)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let host = format!("127.0.0.1:{}", port());
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n");
    if let Some(key) = key {
        head += &format!("Authorization: Bearer {key}\r\n");
    }
    let body = if method == "POST" { "{}" } else { "" };
    if method == "POST" {
        head += &format!("Origin: http://{host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n", body.len());
    }
    stream.write_all(format!("{head}\r\n{body}").as_bytes()).ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let status = response.split(' ').nth(1)?.parse().ok()?;
    let body = response.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    Some((status, body))
}
fn running() -> bool {
    matches!(request("GET", "/api/status", None), Some((200, body)) if body.contains("\"instance\""))
}

// Node.js e o app empacotados ao lado do executável; no checkout, o node do sistema e a raiz do repositório.
fn server_command() -> Option<Command> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let packaged = (exe_dir.join(node_name), exe_dir.join("app"));
    let (node, app) = match (std::env::var_os("MONETA_NODE"), std::env::var_os("MONETA_APP")) {
        (Some(node), Some(app)) => (PathBuf::from(node), PathBuf::from(app)),
        _ if packaged.0.exists() && packaged.1.join("server.mjs").exists() => packaged,
        _ => (PathBuf::from("node"), PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")),
    };
    let mut command = Command::new(node);
    command
        .arg("--disable-warning=ExperimentalWarning")
        .arg(app.join("server.mjs"))
        .arg("--background")
        .current_dir(&app)
        .env("PORT", port().to_string());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    Some(command)
}

struct Server(Mutex<Option<Child>>);

fn start_server(app: &AppHandle) -> Result<(), String> {
    if running() {
        return Ok(());
    }
    let mut command = server_command().ok_or("Não encontrei o servidor do Moneta.")?;
    let child = command.spawn().map_err(|error| format!("Não foi possível iniciar o servidor do Moneta: {error}"))?;
    app.state::<Server>().0.lock().unwrap().replace(child);
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(60) {
        if running() && access_key().is_some() {
            return Ok(());
        }
        if let Some(status) = app.state::<Server>().0.lock().unwrap().as_mut().and_then(|c| c.try_wait().ok().flatten()) {
            return Err(format!("O servidor do Moneta parou ao iniciar ({status})."));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err("O servidor do Moneta não respondeu a tempo.".into())
}

// Servidor iniciado por esta janela: quando ele termina (por "Encerrar o Moneta" na página ou pela
// bandeja), a janela também fecha. Com o serviço do systemd, a janela espera um pouco antes de fechar:
// numa atualização pelo app o serviço reinicia, e a página recarrega sozinha na versão nova.
fn watch_server(app: AppHandle) {
    std::thread::spawn(move || {
        let mut down_since: Option<Instant> = None;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let exited = match app.state::<Server>().0.lock().unwrap().as_mut() {
                Some(child) => child.try_wait().ok().flatten().is_some(),
                None => {
                    if running() {
                        down_since = None;
                        false
                    } else {
                        down_since.get_or_insert_with(Instant::now).elapsed() > Duration::from_secs(90)
                    }
                }
            };
            if exited {
                app.exit(0);
                return;
            }
        }
    });
}

fn is_local(url: &Url) -> bool {
    matches!(url.scheme(), "http") && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost")) && url.port() == Some(port())
}
// O widget da Pluggy roda num iframe dentro da página e precisa navegar livremente.
fn is_pluggy(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| h == "pluggy.ai" || h.ends_with(".pluggy.ai"))
}
fn open_external(url: &Url) {
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return;
    }
    let target = url.as_str();
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        Command::new("rundll32").args(["url.dll,FileProtocolHandler", target]).creation_flags(0x0800_0000).spawn()
    };
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(target).spawn();
    let _ = result;
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = create_window(app, true);
}

fn create_window(app: &AppHandle, visible: bool) -> tauri::Result<WebviewWindow> {
    let downloads = app.path().download_dir().ok();
    WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        .title("Moneta")
        .inner_size(1280.0, 860.0)
        .min_inner_size(380.0, 560.0)
        .visible(visible)
        .on_navigation(|url| {
            if url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") || is_local(url) || is_pluggy(url) || url.scheme() == "about" || url.scheme() == "blob" {
                return true;
            }
            open_external(url);
            false
        })
        .on_new_window(|url, _| {
            open_external(&url);
            NewWindowResponse::Deny
        })
        // Backups e exportações vão para a pasta Downloads, como num navegador.
        .on_download(move |_, event| {
            if let DownloadEvent::Requested { destination, url } = event {
                if let Some(dir) = &downloads {
                    let name = destination
                        .file_name()
                        .map(|n| n.to_owned())
                        .or_else(|| url.path_segments().and_then(|mut s| s.next_back()).map(Into::into))
                        .unwrap_or_else(|| "moneta-download".into());
                    *destination = dir.join(name);
                }
            }
            true
        })
        .build()
}

fn open_dashboard(app: &AppHandle) {
    let target = match access_key() {
        Some(key) => format!("{}/entrar?chave={key}", base_url()),
        None => base_url(),
    };
    if let (Some(window), Ok(url)) = (app.get_webview_window(WINDOW), Url::parse(&target)) {
        let _ = window.navigate(url);
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn shutdown(app: &AppHandle) {
    // Pelo servidor, para gravar o cofre antes de sair; se ele não responder, encerra o processo.
    let stopped = access_key().and_then(|key| request("POST", "/api/shutdown", Some(&key))).is_some_and(|(s, _)| s == 202);
    if !stopped {
        if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
            let _ = child.kill();
        }
        app.exit(0);
    }
}

#[cfg(windows)]
fn tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "abrir", "Abrir o Moneta", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "encerrar", "Encerrar o Moneta", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::with_id("moneta")
        .icon(app.default_window_icon().cloned().expect("ícone do app"))
        .tooltip("Moneta")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "abrir" => show(app),
            "encerrar" => shutdown(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    let background = std::env::args().any(|a| a == "--background");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !args.iter().any(|a| a == "--background") {
                show(app);
            }
        }))
        .manage(Server(Mutex::new(None)))
        .setup(move |app| {
            let handle = app.handle().clone();
            create_window(&handle, !background)?;
            #[cfg(windows)]
            tray(&handle)?;
            std::thread::spawn(move || match start_server(&handle) {
                Ok(()) => {
                    open_dashboard(&handle);
                    watch_server(handle);
                }
                Err(message) => {
                    if let Some(window) = handle.get_webview_window(WINDOW) {
                        let text = serde_json_string(&message);
                        let _ = window.eval(format!("document.getElementById('status').textContent = {text}"));
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // No Windows, fechar só esconde: o Moneta continua na bandeja, sincronizando.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(windows) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Moneta")
        .run(|_, _| {});
}

// Texto como literal de string JavaScript (aspas, barras e quebras de linha escapadas).
fn serde_json_string(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// Atril de escritorio: la misma app web (index.html) en una ventana, más lo que el navegador no puede hacer:
// diálogos de Windows para abrir y guardar, leer y escribir archivos por ruta, y abrir el .atril con que se lanzó
// (doble clic). Si Atril ya está abierta, el segundo doble clic manda el archivo a esa ventana.
use percent_encoding::percent_decode_str;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Emitter, Manager, State, WebviewWindow,
};
use tauri_plugin_dialog::DialogExt;

/// Archivo con que se abrió Atril (doble clic o "Abrir con"); la página lo pide una vez al cargar.
struct Inicial(Mutex<Option<String>>);

fn ruta_de_args(args: &[String], cwd: Option<&str>) -> Option<String> {
    let arg = args.iter().skip(1).find(|a| !a.starts_with('-'))?;
    let mut p = PathBuf::from(arg);
    if p.is_relative() {
        if let Some(c) = cwd {
            p = PathBuf::from(c).join(p);
        }
    }
    Some(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn archivo_inicial(inicial: State<Inicial>) -> Option<String> {
    inicial.0.lock().unwrap().take()
}

#[tauri::command]
fn leer(ruta: String) -> Result<Response, String> {
    fs::read(&ruta).map(Response::new).map_err(|e| e.to_string())
}

/// Escribe los bytes del cuerpo en la ruta del encabezado `ruta` (codificada con encodeURIComponent).
/// Primero en un temporal y luego lo reemplaza: si algo falla, el archivo anterior queda intacto.
#[tauri::command]
fn escribir(request: Request) -> Result<(), String> {
    let ruta = request
        .headers()
        .get("ruta")
        .and_then(|v| v.to_str().ok())
        .ok_or("falta la ruta")?;
    let ruta = percent_decode_str(ruta).decode_utf8().map_err(|e| e.to_string())?.into_owned();
    let InvokeBody::Raw(datos) = request.body() else {
        return Err("se esperaban bytes".into());
    };
    let tmp = format!("{ruta}.guardando");
    fs::write(&tmp, datos).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &ruta).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
async fn elegir_abrir(window: WebviewWindow) -> Option<String> {
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Abrir partitura")
        .add_filter("Partituras (Atril o MusicXML)", &["atril", "musicxml", "xml", "mxl", "zip", "json"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn elegir_guardar(window: WebviewWindow, nombre: String, tipo: String, extensiones: Vec<String>) -> Option<String> {
    let ext: Vec<&str> = extensiones.iter().map(String::as_str).collect();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(&nombre)
        .add_filter(&tipo, &ext)
        .blocking_save_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    tauri::Builder::default()
        // va primero: si Atril ya está abierta, le pasa el archivo y esta segunda instancia se cierra
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(ruta) = ruta_de_args(&args, Some(&cwd)) {
                let _ = app.emit("abrir-archivo", ruta);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Inicial(Mutex::new(ruta_de_args(&args, None))))
        .invoke_handler(tauri::generate_handler![archivo_inicial, leer, escribir, elegir_abrir, elegir_guardar])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Atril");
}

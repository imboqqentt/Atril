// Atril de escritorio: la misma app web (index.html) en una ventana, más lo que el navegador no puede hacer:
// diálogos nativos para abrir y guardar, leer y escribir archivos por ruta, y abrir el .atril con que se lanzó
// (doble clic). Si Atril ya está abierta, el segundo doble clic manda el archivo a esa ventana.
// Funciona en Windows y en macOS (en Mac el doble clic llega como evento Opened, no como argumento).
// Además lee PDF con Audiveris (instalado aparte): lo corre en modo batch y devuelve el MusicXML.
use percent_encoding::percent_decode_str;
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow,
};
use tauri_plugin_dialog::DialogExt;

/// Archivo con que se abrió Atril (doble clic o "Abrir con"); la página lo pide una vez al cargar.
/// El segundo valor queda en true cuando ya lo pidió: desde ahí los archivos van por el evento "abrir-archivo".
struct Inicial(Mutex<(Option<String>, bool)>);

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
    let mut g = inicial.0.lock().unwrap();
    g.1 = true;
    g.0.take()
}

/// Un archivo que llega con Atril ya abierta: a la página si ya está lista, si no queda para cuando lo pida.
fn abrir_en_ventana(app: &AppHandle, ruta: String) {
    {
        let inicial = app.state::<Inicial>();
        let mut g = inicial.0.lock().unwrap();
        if !g.1 {
            g.0 = Some(ruta);
            return;
        }
    }
    let _ = app.emit("abrir-archivo", ruta);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
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

/// Diálogo Abrir. Sin `tipo`, muestra las partituras que Atril abre.
#[tauri::command]
async fn elegir_abrir(window: WebviewWindow, tipo: Option<String>, extensiones: Option<Vec<String>>) -> Option<String> {
    let tipo = tipo.unwrap_or_else(|| "Partituras (Atril o MusicXML)".into());
    let ext = extensiones.unwrap_or_else(|| ["atril", "musicxml", "xml", "mxl", "zip", "json"].map(String::from).to_vec());
    let ext: Vec<&str> = ext.iter().map(String::as_str).collect();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Abrir")
        .add_filter(&tipo, &ext)
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

/* ---------- Audiveris ---------- */

/// Proceso de Audiveris en curso (para cancelarlo o cerrarlo junto con Atril).
struct Audiveris(Mutex<Option<Child>>);

/// Busca Audiveris (Audiveris.exe; en Mac, Audiveris.app): primero la ruta que eligió la persona, luego donde lo
/// deja su instalador. Devuelve el ejecutable.
#[tauri::command]
fn buscar_audiveris(ruta: Option<String>) -> Option<String> {
    let mut candidatos: Vec<PathBuf> = ruta.into_iter().map(PathBuf::from).collect();
    if let Some(home) = std::env::var_os("HOME") {
        candidatos.push(PathBuf::from(home).join("Applications").join("Audiveris.app"));
    }
    candidatos.push(PathBuf::from("/Applications/Audiveris.app"));
    // de una carpeta .app sirve el ejecutable que lleva adentro
    let candidatos = candidatos.into_iter().map(|p| if p.extension().is_some_and(|x| x == "app") { p.join("Contents").join("MacOS").join("Audiveris") } else { p });
    let mut candidatos: Vec<PathBuf> = candidatos.collect();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            let base = PathBuf::from(base);
            candidatos.push(base.join("Audiveris").join("Audiveris.exe"));
            candidatos.push(base.join("Programs").join("Audiveris").join("Audiveris.exe"));
        }
    }
    candidatos.into_iter().find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}

/// Lee un PDF (o imagen) con Audiveris y devuelve las rutas de los .mxl que exportó (uno por movimiento).
/// Cada línea que escribe Audiveris llega a la página como evento "audiveris", para mostrar el avance.
/// `paginas`: hojas a leer, como "1-3"; sin ella, todas.
#[tauri::command]
async fn leer_pdf(app: AppHandle, audiveris: String, pdf: String, paginas: Option<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || correr_audiveris(&app, &audiveris, &pdf, paginas))
        .await
        .map_err(|e| e.to_string())?
}

/// Idiomas de OCR para la letra: español e inglés, si están instalados en Audiveris (Tools → Languages).
/// Audiveris busca los idiomas en TESSDATA_PREFIX o en su carpeta de configuración; sin esto, usaría solo inglés.
fn idiomas_ocr() -> Option<String> {
    let carpeta = std::env::var("TESSDATA_PREFIX")
        .map(PathBuf::from)
        .ok()
        .filter(|p| p.is_dir())
        .or_else(|| {
            // Windows: %APPDATA%/AudiverisLtd/audiveris; Mac: ~/Library/Application Support/AudiverisLtd/audiveris
            let base = std::env::var("APPDATA").map(PathBuf::from).ok().or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library").join("Application Support")))?;
            Some(base.join("AudiverisLtd").join("audiveris").join("config").join("tessdata"))
        })?;
    let idiomas: Vec<&str> = ["spa", "eng"].into_iter().filter(|c| carpeta.join(format!("{c}.traineddata")).is_file()).collect();
    (!idiomas.is_empty()).then(|| idiomas.join("+"))
}

fn correr_audiveris(app: &AppHandle, audiveris: &str, pdf: &str, paginas: Option<String>) -> Result<Vec<String>, String> {
    let salida = std::env::temp_dir().join("atril-audiveris");
    let _ = fs::remove_dir_all(&salida);
    fs::create_dir_all(&salida).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(audiveris);
    cmd.arg("-batch").arg("-export").arg("-output").arg(&salida);
    if let Some(p) = paginas.filter(|p| !p.is_empty()) {
        cmd.arg("-sheets").arg(p);
    }
    if let Some(idiomas) = idiomas_ocr() {
        cmd.arg("-constant").arg(format!("org.audiveris.omr.text.Language.defaultSpecification={idiomas}"));
    }
    cmd.arg("--").arg(pdf).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sin ventana de consola
    }
    let mut hijo = cmd.spawn().map_err(|e| format!("No se pudo iniciar Audiveris: {e}"))?;
    let (out, err) = (hijo.stdout.take().unwrap(), hijo.stderr.take().unwrap());
    *app.state::<Audiveris>().0.lock().unwrap() = Some(hijo);

    // los dos flujos de salida se leen a la vez; las líneas van a la página y se guardan las últimas por si falla
    let leer = |flujo: Box<dyn Read + Send>, app: AppHandle| {
        std::thread::spawn(move || {
            let mut ultimas: Vec<String> = Vec::new();
            for linea in BufReader::new(flujo).lines().map_while(Result::ok) {
                let _ = app.emit("audiveris", &linea);
                ultimas.push(linea);
                if ultimas.len() > 40 {
                    ultimas.remove(0);
                }
            }
            ultimas
        })
    };
    let h_out = leer(Box::new(out), app.clone());
    let h_err = leer(Box::new(err), app.clone());
    let mut ultimas = h_out.join().unwrap_or_default();
    ultimas.extend(h_err.join().unwrap_or_default());

    let hijo = app.state::<Audiveris>().0.lock().unwrap().take();
    let Some(mut hijo) = hijo else {
        return Err("cancelado".into());
    };
    let estado = hijo.wait().map_err(|e| e.to_string())?;

    let mut mxl: Vec<String> = fs::read_dir(&salida)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("mxl")))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    mxl.sort();
    if mxl.is_empty() {
        let detalle = ultimas.iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n");
        return Err(format!("Audiveris no pudo leer la partitura (código {}).\n{detalle}", estado.code().unwrap_or(-1)));
    }
    Ok(mxl)
}

#[tauri::command]
fn cancelar_audiveris(proceso: State<Audiveris>) {
    if let Some(mut hijo) = proceso.0.lock().unwrap().take() {
        let _ = hijo.kill();
        let _ = hijo.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    tauri::Builder::default()
        // va primero: si Atril ya está abierta, le pasa el archivo y esta segunda instancia se cierra
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            match ruta_de_args(&args, Some(&cwd)) {
                Some(ruta) => abrir_en_ventana(app, ruta),
                None => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Inicial(Mutex::new((ruta_de_args(&args, None), false))))
        .manage(Audiveris(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            archivo_inicial,
            leer,
            escribir,
            elegir_abrir,
            elegir_guardar,
            buscar_audiveris,
            leer_pdf,
            cancelar_audiveris
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Atril")
        .run(|app, evento| match evento {
            // si se cierra Atril durante una lectura, Audiveris se cierra también
            RunEvent::Exit => {
                if let Some(mut hijo) = app.state::<Audiveris>().0.lock().unwrap().take() {
                    let _ = hijo.kill();
                }
            }
            // Mac: doble clic en un .atril (o arrastrarlo al ícono), con Atril cerrada o abierta
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                for ruta in urls.iter().filter_map(|u| u.to_file_path().ok()) {
                    abrir_en_ventana(app, ruta.to_string_lossy().into_owned());
                }
            }
            _ => {}
        });
}

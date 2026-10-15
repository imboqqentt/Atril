// Sin ventana de consola en Windows (versión final)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    atril_lib::run()
}

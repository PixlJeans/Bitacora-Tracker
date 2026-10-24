// Sin consola extra en Windows (release)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bitacora_tracker_lib::run()
}

// Jangan munculkan jendela konsol di Windows pada build rilis.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    luna_finance_lib::run()
}

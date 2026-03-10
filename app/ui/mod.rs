mod app;
mod event_handler;
mod state;
mod tree_builder;
mod views;

use anyhow::Result;
use crossterm::{
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;

pub use app::App;

pub fn run_interactive_setup(path: Option<String>) -> Result<()> {
    if let Some(p) = path {
        run_interactive_setup_with_path(p)
    } else {
        run_interactive_setup_terminal()
    }
}

fn run_interactive_setup_with_path(target_path: String) -> Result<()> {
    setup_terminal(|terminal| {
        let mut app = App::with_path(target_path);
        event_handler::run_app(terminal, &mut app)
    })
}

fn run_interactive_setup_terminal() -> Result<()> {
    setup_terminal(|terminal| {
        let mut app = App::new();
        event_handler::run_app(terminal, &mut app)
    })
}

fn setup_terminal<F>(f: F) -> Result<()>
where
    F: FnOnce(&mut Terminal<CrosstermBackend<io::Stdout>>) -> Result<()>,
{
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = f(&mut terminal);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = &res {
        println!("Error: {:?}", err);
    }

    res
}

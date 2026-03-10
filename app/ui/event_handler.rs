use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::Terminal;

use super::{app::App, state::AppState, views};

pub fn run_app<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> Result<()> {
    loop {
        terminal.draw(|f| views::render(f, app))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    handle_key_event(app, key.code)?;

                    if app.should_quit {
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

fn handle_key_event(app: &mut App, key_code: KeyCode) -> Result<()> {
    match app.state {
        AppState::SelectingPath => handle_path_selection(app, key_code),
        AppState::SelectingStack => handle_stack_selection(app, key_code),
        AppState::Confirming => handle_confirmation(app, key_code),
        AppState::ContinueOrQuit => handle_continue_or_quit(app, key_code),
    }
}

fn handle_path_selection(app: &mut App, key_code: KeyCode) -> Result<()> {
    match key_code {
        KeyCode::Char(c) => {
            app.handle_path_input(c);
            app.update_tree();
        }
        KeyCode::Backspace => {
            app.delete_path_char();
            app.update_tree();
        }
        KeyCode::Enter => app.confirm_path(),
        KeyCode::Esc => app.should_quit = true,
        _ => {}
    }
    Ok(())
}

fn handle_stack_selection(app: &mut App, key_code: KeyCode) -> Result<()> {
    match key_code {
        KeyCode::Char('q') => app.should_quit = true,
        KeyCode::Esc => app.cancel_to_path_selection(),
        KeyCode::Down | KeyCode::Char('j') => app.next(),
        KeyCode::Up | KeyCode::Char('k') => app.previous(),
        KeyCode::Enter => app.select()?,
        _ => {}
    }
    Ok(())
}

fn handle_confirmation(app: &mut App, key_code: KeyCode) -> Result<()> {
    match key_code {
        KeyCode::Enter => app.confirm_and_apply()?,
        KeyCode::Esc => app.cancel_confirmation(),
        KeyCode::Char('q') => app.should_quit = true,
        _ => {}
    }
    Ok(())
}

fn handle_continue_or_quit(app: &mut App, key_code: KeyCode) -> Result<()> {
    match key_code {
        KeyCode::Down | KeyCode::Char('j') => app.next_continue(),
        KeyCode::Up | KeyCode::Char('k') => app.previous_continue(),
        KeyCode::Enter => {
            if app.continue_selected == 0 {
                app.reset_for_new_project();
            } else {
                app.should_quit = true;
            }
        }
        KeyCode::Esc => app.should_quit = true,
        _ => {}
    }
    Ok(())
}

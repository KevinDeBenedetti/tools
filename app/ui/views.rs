use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};

use super::{app::App, state::AppState};

pub fn render(f: &mut Frame, app: &App) {
    match app.state {
        AppState::SelectingPath => render_path_selection(f, app),
        AppState::SelectingStack => render_stack_selection(f, app),
        AppState::Confirming => render_confirmation(f, app),
        AppState::ContinueOrQuit => render_continue_or_quit(f, app),
    }
}

fn render_path_selection(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(2)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(5),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(f.area());

    let title = create_title("DevKit - Project Setup", Color::Cyan);
    f.render_widget(title, chunks[0]);

    let input_text = if app.path_input.is_empty() {
        ". (current directory)"
    } else {
        &app.path_input
    };

    let input = Paragraph::new(input_text)
        .style(Style::default().fg(Color::Yellow))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title("📂 Project Path (Enter to confirm)"),
        );
    f.render_widget(input, chunks[1]);

    let tree_items: Vec<ListItem> = app
        .tree_lines
        .iter()
        .map(|line| {
            ListItem::new(Line::from(Span::styled(
                line.clone(),
                Style::default().fg(Color::Gray),
            )))
        })
        .collect();

    let tree = List::new(tree_items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("📁 Project Tree"),
    );
    f.render_widget(tree, chunks[2]);

    let help = create_help("Type path | Enter: Confirm | Esc: Cancel");
    f.render_widget(help, chunks[3]);
}

fn render_stack_selection(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(2)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(f.area());

    let title = create_title(
        &format!("DevKit - Project: {}", app.target_path),
        Color::Cyan,
    );
    f.render_widget(title, chunks[0]);

    let items: Vec<ListItem> = app
        .stacks
        .iter()
        .enumerate()
        .map(|(i, stack)| create_list_item(stack, i == app.selected))
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("📚 Select a stack"),
    );
    f.render_widget(list, chunks[1]);

    let help = create_help("↑/↓: Navigate | Enter: Select | Esc: Cancel");
    f.render_widget(help, chunks[2]);
}

fn render_confirmation(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(2)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(f.area());

    let title = create_title("DevKit - Confirmation", Color::Cyan);
    f.render_widget(title, chunks[0]);

    let confirmation_text = format!(
        "Do you want to apply the {} configuration into {}?\n\n\
        The following files will be created:\n\
        • Makefile\n\
        • Dockerfile\n\
        • .dockerignore\n\n\
        This action will create or overwrite these files.",
        app.selected_stack, app.target_path
    );

    let text = Paragraph::new(confirmation_text)
        .style(Style::default().fg(Color::White))
        .alignment(Alignment::Left)
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(text, chunks[1]);

    let help = create_help("Enter: Confirm | Esc: Cancel");
    f.render_widget(help, chunks[2]);
}

fn render_continue_or_quit(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(2)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(7),
            Constraint::Length(3),
        ])
        .split(f.area());

    let title = create_title("✓ Setup complete!", Color::Green);
    f.render_widget(title, chunks[0]);

    let options = vec![
        "🔄 Configure another project (monorepo)",
        "🚪 Quit assistant",
    ];

    let items: Vec<ListItem> = options
        .iter()
        .enumerate()
        .map(|(i, option)| {
            let style = if i == app.continue_selected {
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::Green)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            let content = Line::from(vec![Span::raw("  "), Span::styled(*option, style)]);
            ListItem::new(content)
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::ALL)
            .title("What would you like to do?"),
    );
    f.render_widget(list, chunks[1]);

    let help = create_help("↑/↓: Navigate | Enter: Confirm");
    f.render_widget(help, chunks[2]);
}

fn create_title(text: &str, color: Color) -> Paragraph<'static> {
    Paragraph::new(text.to_string())
        .style(Style::default().fg(color).add_modifier(Modifier::BOLD))
        .alignment(Alignment::Center)
        .block(Block::default().borders(Borders::ALL))
}

fn create_help(text: &str) -> Paragraph<'static> {
    Paragraph::new(text.to_string())
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center)
        .block(Block::default().borders(Borders::ALL))
}

fn create_list_item(text: &str, is_selected: bool) -> ListItem<'static> {
    let style = if is_selected {
        Style::default()
            .fg(Color::Black)
            .bg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::White)
    };

    let content = Line::from(vec![Span::raw("  "), Span::styled(text.to_string(), style)]);
    ListItem::new(content)
}

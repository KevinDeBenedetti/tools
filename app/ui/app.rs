use super::{state::AppState, tree_builder::build_tree_lines};
use crate::config;
use anyhow::Result;

pub struct App {
    pub stacks: Vec<String>,
    pub selected: usize,
    pub should_quit: bool,
    pub state: AppState,
    pub path_input: String,
    pub target_path: String,
    pub tree_lines: Vec<String>,
    pub selected_stack: String,
    pub continue_selected: usize,
}

impl App {
    pub fn new() -> Self {
        Self::with_path(String::new())
    }

    pub fn with_path(target_path: String) -> Self {
        let current_dir = Self::current_directory();
        let tree_lines = if target_path.is_empty() {
            build_tree_lines(&current_dir, 3)
        } else {
            build_tree_lines(&target_path, 3)
        };

        Self {
            stacks: config::get_available_stacks(),
            selected: 0,
            should_quit: false,
            state: if target_path.is_empty() {
                AppState::SelectingPath
            } else {
                AppState::SelectingStack
            },
            path_input: String::new(),
            target_path,
            tree_lines,
            selected_stack: String::new(),
            continue_selected: 0,
        }
    }

    fn current_directory() -> String {
        std::env::current_dir()
            .ok()
            .and_then(|p| p.to_str().map(String::from))
            .unwrap_or_else(|| ".".to_string())
    }

    pub fn next(&mut self) {
        if self.selected < self.stacks.len().saturating_sub(1) {
            self.selected += 1;
        }
    }

    pub fn previous(&mut self) {
        self.selected = self.selected.saturating_sub(1);
    }

    pub fn select(&mut self) -> Result<()> {
        self.selected_stack = self.stacks[self.selected].clone();
        self.state = AppState::Confirming;
        Ok(())
    }

    pub fn confirm_and_apply(&mut self) -> Result<()> {
        config::apply_stack_config(&self.selected_stack, &self.target_path)?;
        self.state = AppState::ContinueOrQuit;
        Ok(())
    }

    pub fn cancel_confirmation(&mut self) {
        self.state = AppState::SelectingStack;
    }

    pub fn reset_for_new_project(&mut self) {
        let current_dir = Self::current_directory();
        self.path_input.clear();
        self.target_path.clear();
        self.selected = 0;
        self.continue_selected = 0;
        self.tree_lines = build_tree_lines(&current_dir, 3);
        self.state = AppState::SelectingPath;
    }

    pub fn next_continue(&mut self) {
        if self.continue_selected < 1 {
            self.continue_selected += 1;
        }
    }

    pub fn previous_continue(&mut self) {
        self.continue_selected = self.continue_selected.saturating_sub(1);
    }

    pub fn confirm_path(&mut self) {
        self.target_path = if self.path_input.is_empty() {
            ".".to_string()
        } else {
            self.path_input.clone()
        };
        self.state = AppState::SelectingStack;
    }

    pub fn handle_path_input(&mut self, c: char) {
        self.path_input.push(c);
    }

    pub fn delete_path_char(&mut self) {
        self.path_input.pop();
    }

    pub fn update_tree(&mut self) {
        let path = if self.path_input.is_empty() {
            "."
        } else {
            &self.path_input
        };
        self.tree_lines = build_tree_lines(path, 3);
    }

    pub fn cancel_to_path_selection(&mut self) {
        self.state = AppState::SelectingPath;
        self.selected_stack = String::new();
        self.selected = 0;
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AppState {
    SelectingPath,
    SelectingStack,
    Confirming,
    ContinueOrQuit,
}

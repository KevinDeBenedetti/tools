use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "devkit")]
#[command(about = "Configure web projects by stack", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Launch the interactive interface to configure the project
    Init {
        #[arg(short, long, default_value = ".")]
        path: String,
    },

    /// Directly configure a specific stack
    Config {
        /// One or more stacks to apply (repeatable: --stack rls --stack wasm)
        #[arg(required = true)]
        stacks: Vec<String>,

        /// Optional target path for generated files (default = current dir)
        #[arg(short, long)]
        path: Option<String>,
    },

    /// List all available stacks
    List,
}

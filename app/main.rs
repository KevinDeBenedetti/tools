mod cli;
mod config;
mod ui;

use anyhow::Result;
use clap::Parser;
use cli::Cli;

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        cli::Commands::Init { path } => {
            // Launch the TUI interface
            ui::run_interactive_setup(path)?;
        }
        cli::Commands::Config { stacks, path } => {
            let target_path = path.unwrap_or_else(|| ".".to_string());

            // Apply configuration for each stack
            for stack in &stacks {
                config::apply_stack_config(stack, &target_path)?;
            }

            // Generate Makefile with all stacks
            config::generate_makefile(&stacks, &target_path)?;

            println!(
                "✓ Configuration for [{}] applied successfully in {}",
                stacks.join(", "),
                target_path
            );
            println!("✓ Makefile generated with stack configurations");
        }
        cli::Commands::List => {
            // List available stacks
            let stacks = config::get_available_stacks();
            println!("Available stacks:");
            for stack in stacks {
                println!("  • {}", stack);
            }
        }
    }

    Ok(())
}

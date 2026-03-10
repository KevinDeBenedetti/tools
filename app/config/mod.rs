use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct StackConfig {
    pub name: String,
    pub description: String,
    pub files: Vec<FileTemplate>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileTemplate {
    pub path: String,
    pub content: String,
}

pub const AVAILABLE_STACKS: [&str; 3] = ["vue", "nuxt", "fastapi"];

pub fn get_available_stacks() -> Vec<String> {
    AVAILABLE_STACKS.iter().map(|s| s.to_string()).collect()
}

pub fn apply_stack_config(stack: &str, target_path: &str) -> Result<()> {
    let config = get_stack_config(stack)?;
    let base_path = PathBuf::from(target_path);

    // Print current tree
    println!("\n📂 Target directory: {}", base_path.display());
    display_tree(&base_path, 0, 2)?;

    println!("\n🔧 Configuring stack {}...", config.name);

    // Create configuration files (Dockerfile, Makefile, .dockerignore, etc.)
    for file in &config.files {
        let file_path = base_path.join(&file.path);
        create_file(&file_path, &file.content).context(format!("Error creating {}", file.path))?;
    }

    println!("\n✓ Configuration complete!");
    println!("\n📂 Updated tree:");
    display_tree(&base_path, 0, 2)?;

    println!("\n📝 Next steps:");
    println!(
        "  cd {}        # Change to project directory",
        base_path.display()
    );
    println!("  make help      # See all available commands");
    println!("  make install   # Install dependencies");
    println!("  make dev       # Run in development");

    Ok(())
}

/// Display a directory tree
fn display_tree(path: &Path, depth: usize, max_depth: usize) -> Result<()> {
    if depth > max_depth {
        return Ok(());
    }

    if !path.exists() {
        println!(
            "{}└── (empty or non-existent directory)",
            "  ".repeat(depth)
        );
        return Ok(());
    }

    let entries = fs::read_dir(path)
        .context("Impossible de lire le répertoire")?
        .filter_map(|e| e.ok())
        .collect::<Vec<_>>();

    for (i, entry) in entries.iter().enumerate() {
        let is_last = i == entries.len() - 1;
        let prefix = if is_last { "└── " } else { "├── " };
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // Ignore hidden folders and node_modules
        if file_name_str.starts_with('.')
            || file_name_str == "node_modules"
            || file_name_str == "target"
        {
            continue;
        }

        println!("{}{}{}", "  ".repeat(depth), prefix, file_name_str);

        if entry.path().is_dir() && depth < max_depth {
            display_tree(&entry.path(), depth + 1, max_depth)?;
        }
    }

    Ok(())
}

/// Create a file with its content
fn create_file(path: &Path, content: &str) -> Result<()> {
    // Create parent directories if necessary
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .context(format!("Unable to create directory {}", parent.display()))?;
    }

    // Write the file
    fs::write(path, content).context(format!("Unable to write {}", path.display()))?;

    println!("  ✓ {} created", path.display());
    Ok(())
}

fn get_stack_config(stack_name: &str) -> Result<StackConfig> {
    match stack_name {
        "vue" => Ok(StackConfig {
            name: "Vue".to_string(),
            description: "Vue 3 application with TypeScript".to_string(),
            files: vec![
                FileTemplate {
                    path: "vue.mk".to_string(),
                    content: include_str!("../templates/vue/vue.mk").to_string(),
                },
                FileTemplate {
                    path: "Dockerfile".to_string(),
                    content: include_str!("../templates/vue/Dockerfile").to_string(),
                },
                FileTemplate {
                    path: ".dockerignore".to_string(),
                    content: include_str!("../templates/vue/.dockerignore").to_string(),
                },
            ],
        }),
        "nuxt" => Ok(StackConfig {
            name: "Nuxt".to_string(),
            description: "Nuxt 3 application with TypeScript".to_string(),
            files: vec![
                FileTemplate {
                    path: "nuxt.mk".to_string(),
                    content: include_str!("../templates/nuxt/nuxt.mk").to_string(),
                },
                FileTemplate {
                    path: "Dockerfile".to_string(),
                    content: include_str!("../templates/nuxt/Dockerfile").to_string(),
                },
                FileTemplate {
                    path: ".dockerignore".to_string(),
                    content: include_str!("../templates/nuxt/.dockerignore").to_string(),
                },
            ],
        }),
        "fastapi" => Ok(StackConfig {
            name: "FastAPI".to_string(),
            description: "REST API with FastAPI and Python".to_string(),
            files: vec![
                FileTemplate {
                    path: "fastapi.mk".to_string(),
                    content: include_str!("../templates/fastapi/fastapi.mk").to_string(),
                },
                FileTemplate {
                    path: "Dockerfile".to_string(),
                    content: include_str!("../templates/fastapi/Dockerfile").to_string(),
                },
                FileTemplate {
                    path: ".dockerignore".to_string(),
                    content: include_str!("../templates/fastapi/.dockerignore").to_string(),
                },
            ],
        }),
        _ => Err(anyhow!("Stack '{}' not recognized", stack_name)),
    }
}

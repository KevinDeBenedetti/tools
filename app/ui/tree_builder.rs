use std::fs;
use std::path::Path;

pub fn build_tree_lines(path: &str, max_depth: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let path = Path::new(path);

    if !path.exists() {
        lines.push("  (path does not exist)".to_string());
        return lines;
    }

    let display_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path.to_str().unwrap_or("."));

    lines.push(format!("📂 {} (./)", display_name));
    build_tree_recursive(path, &mut lines, "", 0, max_depth, "./".to_string());

    lines
}

fn build_tree_recursive(
    path: &Path,
    lines: &mut Vec<String>,
    prefix: &str,
    depth: usize,
    max_depth: usize,
    current_path: String,
) {
    if depth >= max_depth {
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.path());

    let filtered_entries: Vec<_> = entries
        .into_iter()
        .filter(|entry| should_include_entry(entry))
        .collect();

    for (i, entry) in filtered_entries.iter().enumerate() {
        let is_last = i == filtered_entries.len() - 1;
        let connector = if is_last { "└── " } else { "├── " };
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        let relative_path = format!("{}{}", current_path, file_name_str);

        lines.push(format!(
            "{}{}{} {} ({})",
            prefix, connector, "📁", file_name_str, relative_path
        ));

        let new_prefix = format!("{}{}", prefix, if is_last { "    " } else { "│   " });
        let new_path = format!("{}/", relative_path);
        build_tree_recursive(
            &entry.path(),
            lines,
            &new_prefix,
            depth + 1,
            max_depth,
            new_path,
        );
    }
}

fn should_include_entry(entry: &fs::DirEntry) -> bool {
    const EXCLUDED_DIRS: &[&str] = &["node_modules", "target", "dist", "build"];

    let file_name = entry.file_name();
    let file_name_str = file_name.to_string_lossy();

    entry.path().is_dir()
        && !file_name_str.starts_with('.')
        && !EXCLUDED_DIRS.contains(&file_name_str.as_ref())
}

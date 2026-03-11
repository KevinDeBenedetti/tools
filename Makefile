.DEFAULT_GOAL := help
SHELL         := /bin/bash

SHELL_DIR     := shell/github
TESTS_DIR     := tests/github

# ──────────────────────────────────────────────────────────────────────────────
# Help
# ──────────────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}'

# ──────────────────────────────────────────────────────────────────────────────
# Shell tools
# ──────────────────────────────────────────────────────────────────────────────
# All flags go through ARGS=. Examples:
#   make purge-actions ARGS="--repo owner/repo --dry-run"
#   make detect-bots ARGS="--repo owner/repo"
#   make clean-repo ARGS="--dry-run"
#   make backup-repos

SCRIPTS := purge-actions purge-release purge-tags \
           backup-repos clean-repo detect-bots \
           maintain-all scan-secrets

.PHONY: $(SCRIPTS)

purge-actions: ## Purge GitHub Actions workflow runs
purge-release: ## Purge GitHub releases
purge-tags:    ## Purge GitHub tags
backup-repos:  ## Backup all GitHub repos as bare mirrors
clean-repo:    ## Clean unwanted files from Git history
detect-bots:   ## Detect bot commits in a Git repo
maintain-all:  ## Run full maintenance on all GitHub repos
scan-secrets:  ## Scan a Git repo for leaked secrets

$(SCRIPTS):
	$(SHELL_DIR)/$@.sh $(ARGS)

# ──────────────────────────────────────────────────────────────────────────────
# Tests (Bats)
# ──────────────────────────────────────────────────────────────────────────────

TEST_TARGETS := $(addprefix test-,$(SCRIPTS))

.PHONY: test $(TEST_TARGETS)

test: ## Run all Bats tests
	bats $(TESTS_DIR)/

$(TEST_TARGETS): test-%: ## Run tests for a specific tool
	bats $(TESTS_DIR)/$*.bats

# ──────────────────────────────────────────────────────────────────────────────
# Lint
# ──────────────────────────────────────────────────────────────────────────────

.PHONY: lint

lint: ## Run ShellCheck on all shell scripts
	find $(SHELL_DIR) -type f -name "*.sh" \
		-exec shellcheck --severity=warning --shell=bash --format=gcc {} +

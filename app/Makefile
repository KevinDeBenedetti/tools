CARGO ?= cargo

all: build

build:
	$(CARGO) build

release:
	$(CARGO) build --release

run:
	$(CARGO) run -- init

run-list:
	$(CARGO) run -- list

run-config:
	@echo "Usage: make run-config STACK=<stack> [PATH=<path>]"
	@echo "Example: make run-config STACK=vue PATH=./my-project"

run-release:
	$(CARGO) run --release -- init

check:
	$(CARGO) check
test:
	$(CARGO) test

fmt:
	$(CARGO) fmt

fmt-check:
	$(CARGO) fmt -- --check

clippy:
	$(CARGO) clippy --all-targets --all-features -- -D warnings

clippy-warn:
	$(CARGO) clippy --all-targets --all-features

doc:
	$(CARGO) doc --no-deps

bench:
	$(CARGO) bench

install:
	$(CARGO) install --path .

package:
	$(CARGO) package

publish:
	$(CARGO) publish

update:
	$(CARGO) update

clean:
	$(CARGO) clean

ci: fmt-check clippy check test

help:
	@printf "Usage: make <target>\n\nTargets:\n  build         Build (default)\n  release       Build release\n  run           Run TUI (init command)\n  run-list      List available stacks\n  run-config    Show usage for config command\n  run-release   Run release build (init)\n  check         cargo check\n  test          Run tests\n  fmt           Format code\n  fmt-check     Check formatting\n  clippy        Lint and treat warnings as errors\n  doc           Build docs\n  bench         Run benchmarks\n  install       cargo install --path .\n  package       cargo package\n  publish       cargo publish\n  update        cargo update\n  clean         cargo clean\n  ci            fmt-check, clippy, check, test\n"

.PHONY: all help build release run run-list run-config run-release check test fmt fmt-check clippy clippy-warn doc bench install package publish update clean ci
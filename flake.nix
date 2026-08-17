{
  description = "DeepSeek Harness — plugin-based agent harness development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # Node.js 24.x as required by the project (engines: ^22.19 || >=24)
        nodejs = pkgs.nodejs_24;

        # pnpm 11.x matching the project's packageManager constraint
        pnpm = pkgs.pnpm.override {
          nodejs = nodejs;
        };
      in {
        devShells.default = pkgs.mkShell {
          name = "deepseek-harness";
          description = "Development shell for DeepSeek Harness";

          packages = [
            # Core toolchain
            nodejs
            pnpm

            # Build dependencies
            pkgs.git
            pkgs.typescript
            pkgs.tsx

            # Shell dependencies needed by tests and runtime
            pkgs.bash
            pkgs.coreutils
            pkgs.findutils
            pkgs.gnugrep
            pkgs.gnumake
            pkgs.gnused
            pkgs.gnutar
            pkgs.gzip

            # Python SDK support
            pkgs.python3

            # Optional: native dependencies for sandbox
            pkgs.landlock-linux
          ];

          # Set up the environment for pnpm workspaces
          shellHook = ''
            export NODE_ENV=development
            export CI=false

            # pnpm stores its global cache here to avoid per-project duplication
            export PNPM_HOME="$HOME/.local/share/pnpm"
            mkdir -p "$PNPM_HOME"

            # Node.js project conventions
            export COREPACK_ENABLE_STRICT=0
            export COREPACK_ROOT="$PWD"

            echo "DeepSeek Harness dev shell"
            echo "  Node.js:  $(node --version)"
            echo "  pnpm:     $(pnpm --version)"
            echo "  Git:      $(git --version)"
            echo ""
            echo "Quick start:"
            echo "  pnpm install          # Install workspace dependencies"
            echo "  pnpm run test:gui     # Run client package tests"
            echo "  pnpm run test         # Run all unit tests"
            echo "  pnpm run build        # Build everything"
            echo "  pnpm run typecheck    # Type-check all packages"
          '';

          # Ensure pnpm uses its own version from Nix rather than corepack
          # This prevents corepack from downloading a different pnpm version
          env = {
            COREPACK_ENABLE_STRICT = "0";
            COREPACK_ROOT = "";
            COREPACK_ENABLE_UNSPECIFIED = "0";
          };
        };
      });
}

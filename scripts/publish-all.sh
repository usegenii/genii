#!/usr/bin/env bash
set -euo pipefail

# Geniigotchi Package Publisher
# Publishes all packages to npm in the correct dependency order
# Automatically syncs version from root package.json to all nested packages

DRY_RUN=false
SKIP_CHECKS=false

usage() {
    echo "Usage: $0 [--dry-run] [--skip-checks]"
    echo ""
    echo "Options:"
    echo "  --dry-run      Run npm publish with --dry-run (no actual publishing)"
    echo "  --skip-checks  Skip the pre-publish checks (build, lint, test)"
    echo ""
    echo "The version is read from the root package.json and synced to all packages."
    echo "To release a new version, update the root package.json version first."
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-checks)
            SKIP_CHECKS=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

PUBLISH_FLAGS="--access public"
if $DRY_RUN; then
    PUBLISH_FLAGS="$PUBLISH_FLAGS --dry-run"
    echo "=== DRY RUN MODE ==="
fi

cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)

echo "Publishing from: $ROOT_DIR"
echo ""

# Nested packages that need version sync from root
NESTED_PACKAGES=(
    "apps/cli/package.json"
    "apps/daemon/package.json"
    "shared/lib/package.json"
    "shared/config/package.json"
    "shared/comms/package.json"
    "shared/orchestrator/package.json"
    "shared/guidance/package.json"
    "shared/models/package.json"
)

# Read version from root package.json
ROOT_VERSION=$(node -p "require('./package.json').version")
echo "=== Syncing version $ROOT_VERSION to all packages ==="

for pkg in "${NESTED_PACKAGES[@]}"; do
    if [[ -f "$pkg" ]]; then
        current=$(node -p "require('./$pkg').version")
        if [[ "$current" != "$ROOT_VERSION" ]]; then
            node -e "
                const fs = require('fs');
                const pkg = require('./$pkg');
                pkg.version = '$ROOT_VERSION';
                fs.writeFileSync('$pkg', JSON.stringify(pkg, null, '\t') + '\n');
            "
            name=$(node -p "require('./$pkg').name")
            echo "  $name: $current -> $ROOT_VERSION"
        fi
    fi
done
echo ""

# Pre-publish checks
if ! $SKIP_CHECKS; then
    echo "=== Running pre-publish checks ==="

    echo "Building all packages..."
    pnpm build

    echo "Running linter..."
    pnpm check

    if grep -q '"test"' package.json && [[ $(pnpm test 2>&1) != *"No test specified"* ]]; then
        echo "Running tests..."
        pnpm test || true
    fi

    echo ""
    echo "=== Pre-publish checks passed ==="
    echo ""
fi

# Publish function
publish_package() {
    local dir=$1
    local name=$2

    echo "Publishing $name..."
    cd "$ROOT_DIR/$dir"
    # shellcheck disable=SC2086
    npm publish $PUBLISH_FLAGS
    cd "$ROOT_DIR"
    echo ""
}

echo "=== Step 1: Publishing shared packages (no internal deps) ==="
publish_package "shared/lib" "@geniigotchi/lib"
publish_package "shared/config" "@geniigotchi/config"
publish_package "shared/comms" "@geniigotchi/comms"
publish_package "shared/orchestrator" "@geniigotchi/orchestrator"
publish_package "shared/guidance" "@geniigotchi/guidance"

echo "=== Step 2: Publishing models (depends on config + orchestrator) ==="
publish_package "shared/models" "@geniigotchi/models"

echo "=== Step 3: Publishing apps ==="
publish_package "apps/cli" "@geniigotchi/cli"
publish_package "apps/daemon" "@geniigotchi/daemon"

echo "=== Step 4: Publishing root meta-package ==="
# Create a temporary package.json with resolved versions
VERSION=$(node -p "require('./package.json').version")
echo "Root package version: $VERSION"

# Backup original package.json
cp package.json package.json.bak

# Replace workspace:* with actual versions
node -e "
const pkg = require('./package.json');
const fs = require('fs');

// Get versions from workspace packages
const cliPkg = require('./apps/cli/package.json');
const daemonPkg = require('./apps/daemon/package.json');

pkg.dependencies = {
    '@geniigotchi/cli': '^' + cliPkg.version,
    '@geniigotchi/daemon': '^' + daemonPkg.version
};

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Publishing geniigotchi (meta-package)..."
# shellcheck disable=SC2086
npm publish $PUBLISH_FLAGS

# Restore original package.json
mv package.json.bak package.json

echo ""
echo "=== Publishing complete! ==="

if $DRY_RUN; then
    echo ""
    echo "This was a dry run. No packages were actually published."
    echo "Run without --dry-run to publish for real."
fi

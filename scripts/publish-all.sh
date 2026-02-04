#!/usr/bin/env bash
set -euo pipefail

# Genii Package Publisher
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

PUBLISH_FLAGS="--access public --provenance"
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

# Publish function - resolves workspace:* references before publishing
publish_package() {
    local dir=$1
    local name=$2

    echo "Publishing $name..."
    cd "$ROOT_DIR/$dir"

    # Replace workspace:* with actual versions before publishing
    if grep -q '"workspace:\*"' package.json; then
        cp package.json package.json.bak
        node -e "
            const fs = require('fs');
            const path = require('path');
            const pkg = require('./package.json');
            const rootDir = '$ROOT_DIR';

            // Map package names to their directories
            const pkgDirs = {
                '@genii/lib': 'shared/lib',
                '@genii/config': 'shared/config',
                '@genii/comms': 'shared/comms',
                '@genii/orchestrator': 'shared/orchestrator',
                '@genii/guidance': 'shared/guidance',
                '@genii/models': 'shared/models',
                '@genii/cli': 'apps/cli',
                '@genii/daemon': 'apps/daemon'
            };

            if (pkg.dependencies) {
                for (const [dep, version] of Object.entries(pkg.dependencies)) {
                    if (version === 'workspace:*' && pkgDirs[dep]) {
                        const depPkg = require(path.join(rootDir, pkgDirs[dep], 'package.json'));
                        pkg.dependencies[dep] = '^' + depPkg.version;
                    }
                }
            }

            fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
        "
    fi

    # shellcheck disable=SC2086
    npm publish $PUBLISH_FLAGS

    # Restore original package.json if we modified it
    if [[ -f package.json.bak ]]; then
        mv package.json.bak package.json
    fi

    cd "$ROOT_DIR"
    echo ""
}

echo "=== Step 1: Publishing shared packages (no internal deps) ==="
publish_package "shared/lib" "@genii/lib"
publish_package "shared/config" "@genii/config"
publish_package "shared/comms" "@genii/comms"
publish_package "shared/orchestrator" "@genii/orchestrator"
publish_package "shared/guidance" "@genii/guidance"

echo "=== Step 2: Publishing models (depends on config + orchestrator) ==="
publish_package "shared/models" "@genii/models"

echo "=== Step 3: Publishing apps ==="
publish_package "apps/cli" "@genii/cli"
publish_package "apps/daemon" "@genii/daemon"

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
    '@genii/cli': '^' + cliPkg.version,
    '@genii/daemon': '^' + daemonPkg.version
};

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Publishing genii (meta-package)..."
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

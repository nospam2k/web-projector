#!/bin/bash

# Quick save script to commit and push all changes

echo "🔍 Checking for changes..."
echo ""

if git diff-index --quiet HEAD --; then
    echo "✓ No uncommitted changes"
else
    echo "📝 Uncommitted changes found:"
    git status --short
    echo ""
    read -p "Commit message: " message

    if [ -z "$message" ]; then
        message="Save changes $(date '+%Y-%m-%d %H:%M:%S')"
    fi

    git add .
    git commit -m "$message"
fi

echo ""
echo "📤 Checking if push needed..."

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u} 2>/dev/null)

if [ -z "$REMOTE" ]; then
    echo "⚠️  No remote tracking branch"
elif [ "$LOCAL" != "$REMOTE" ]; then
    echo "🚀 Pushing to GitHub..."
    git push
    echo "✓ All changes backed up to GitHub!"
else
    echo "✓ Already up to date with GitHub"
fi

echo ""

# 🚀 Release Dashboard

A release management tool for the develop → main branch flow built with GitHub Actions.

## 📖 Overview

Automatically tracks PRs merged into the develop branch but not yet released to the main branch, and manages them in a dedicated dashboard Issue.

## ✨ Features

- Runs automatically on pushes or PR merges to the develop branch
- Manages the list of unreleased PRs in a single fixed Issue
- Automatically generates PR creation links
- Removes items automatically after release to the main branch
- **Supports all merge methods: Squash, Rebase, and Merge commit**
- **Automatic merge-back when using Squash merge**
- Usable from external repositories as a composite action (recommended) or as a reusable workflow
- Supports custom branch names

## 🚀 Quick Start

Create `.github/workflows/release-dashboard.yml`:

```yaml
name: 🚀 Release Dashboard

on:
  push:
    branches:
      - develop
      - main
  workflow_dispatch:

permissions:
  contents: read
  issues: write
  pull-requests: read

jobs:
  update-dashboard:
    runs-on: ubuntu-latest
    steps:
      - uses: kyo-ago/release-dashboard-action@main
```

Commit and push to finish.

> **Note**
> The composite action (`uses: kyo-ago/release-dashboard-action@<ref>`) is the
> recommended invocation. The runner downloads it via the standard action
> distribution path, which works for private callers as long as the
> organization allows it under **Settings → Actions → General → Access**.
>
> A reusable-workflow form
> (`uses: kyo-ago/release-dashboard-action/.github/workflows/release-dashboard.yml@<ref>`)
> is still provided for backward compatibility, but it relies on
> `actions/checkout` to pull this repository using the caller's `GITHUB_TOKEN`.
> Private callers cannot read another private repository with `GITHUB_TOKEN`,
> so the reusable-workflow form fails with `repository not found` for that
> case. Use the composite action instead.

## 🎯 Usage

### Automatic Execution

Runs automatically in the following cases:

- Direct pushes to the develop branch
- PR merges into the develop branch

### Manual Execution

1. Open the repository's Actions tab
2. Select the "🚀 Release Dashboard" workflow
3. Click the "Run workflow" button

## 🔧 Customization

### Change Branch Names

```yaml
jobs:
  update-dashboard:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: read
    steps:
      - uses: kyo-ago/release-dashboard-action@main
        with:
          develop_branch: staging
          main_branch: production
```

### Version Pinning

```yaml
# Latest
- uses: kyo-ago/release-dashboard-action@main

# Pin by tag
- uses: kyo-ago/release-dashboard-action@v1.0.0

# Pin by commit hash
- uses: kyo-ago/release-dashboard-action@abc1234
```

## 🔄 Squash Merge Support

If you use Squash Merge for releases from develop → main, the Git history diverges and conflicts can occur on the next release.

To solve this, we provide an **automatic merge-back feature**.

### Setup

Create `.github/workflows/sync-branches.yml`:

```yaml
name: 🔄 Sync Main to Develop

on:
  push:
    branches:
      - main

jobs:
  sync-branches:
    uses: kyo-ago/release-dashboard-action/.github/workflows/sync-branches.yml@main
    permissions:
      contents: write
      pull-requests: write
```

### How It Works

1. **Runs automatically on pushes to the main branch**
2. **Automatically creates a PR to merge main back into develop**
3. **Automatically merges if there are no conflicts**
4. **Prompts manual resolution if conflicts exist**

### Options

```yaml
jobs:
  sync-branches:
    uses: kyo-ago/release-dashboard-action/.github/workflows/sync-branches.yml@main
    with:
      develop_branch: 'develop'  # Custom branch name
      main_branch: 'main'        # Custom branch name
      auto_merge: true           # Enable auto-merge (default: true)
    permissions:
      contents: write
      pull-requests: write
```

### Why Is This Needed?

| Merge method | Git history | Next release | Merge-back |
|-------------|-------------|--------------|------------|
| Merge commit | Preserved | ✅ No conflicts | Not needed |
| Squash merge | **Combined** | ⚠️ Conflicts likely | **Required** |
| Rebase merge | Rewritten | ⚠️ Conflicts likely | **Recommended** |

## 🔍 Troubleshooting

### Workflow does not run

- Verify GitHub Actions is enabled
- Verify Actions execution is allowed in repository settings

### Dashboard Issue is not created

- Check error messages in the Actions logs
- Check workflow permissions (`issues: write`, `pull-requests: read`)

## 📝 License

MIT License

## 🤝 Contributing

Issues and pull requests are welcome!

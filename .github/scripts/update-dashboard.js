/**
 * Release Dashboard Update Script
 *
 * This script tracks PRs merged into the develop branch but not yet released to the main branch,
 * and creates or updates a dedicated dashboard Issue.
 */

const DASHBOARD_LABEL = 'release-dashboard';
const DASHBOARD_TITLE = '🚀 Release Dashboard';

/**
 * Check whether the event meets execution criteria
 */
function shouldExecute(context) {
  const isValidEvent = context.eventName === 'push' ||
                       context.eventName === 'workflow_dispatch' ||
                       (context.eventName === 'pull_request' && context.payload.pull_request?.merged === true);

  if (!isValidEvent) {
    console.log('Skipping execution - event does not meet criteria');
    console.log(`Event name: ${context.eventName}`);
    console.log(`PR merged: ${context.payload.pull_request?.merged}`);
  }

  return isValidEvent;
}

/**
 * Detect merge to main branch
 */
function isMainBranchMerge(context, mainBranch) {
  const isMergeToMain =
    (context.eventName === 'push' && context.ref === `refs/heads/${mainBranch}`) ||
    (context.eventName === 'pull_request' &&
     context.payload.pull_request?.merged === true &&
     context.payload.pull_request?.base?.ref === mainBranch);

  if (isMergeToMain) {
    console.log(`Detected merge to ${mainBranch} branch`);
  }

  return isMergeToMain;
}

/**
 * Get the latest commit on the main branch
 */
async function getMainBranchCommit(github, owner, repo, mainBranch) {
  try {
    const mainBranchData = await github.rest.repos.getBranch({
      owner,
      repo,
      branch: mainBranch
    });
    const mainCommit = mainBranchData.data.commit.sha;
    console.log(`${mainBranch} branch commit: ${mainCommit}`);
    return mainCommit;
  } catch (error) {
    console.log(`${mainBranch} branch does not exist yet. Creating dashboard with all PRs.`);
    return null;
  }
}

/**
 * Get PRs merged into the develop branch
 */
async function getMergedPRs(github, owner, repo, developBranch) {
  // Paginate across all pages
  const allClosedPRs = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'closed',
    base: developBranch,
    sort: 'updated',
    direction: 'desc',
    per_page: 100
  });

  // Filter only merged PRs and limit to 1000
  const mergedPRs = allClosedPRs
    .filter(pr => pr.merged_at !== null)
    .slice(0, 1000);

  console.log(`Found ${mergedPRs.length} merged PRs to ${developBranch}`);
  return mergedPRs;
}

/**
 * Get commit SHAs not yet included in main (method 1: commit SHA matching)
 */
async function getUnreleasedCommitShas(github, owner, repo, mainBranch, developBranch) {
  try {
    // Use GitHub compare API to get the diff between main...develop
    const comparison = await github.rest.repos.compareCommits({
      owner,
      repo,
      base: mainBranch,
      head: developBranch
    });

    // Return SHAs not yet included in main as a Set
    const unreleasedShas = new Set(comparison.data.commits.map(commit => commit.sha));
    console.log(`Found ${unreleasedShas.size} unreleased commits in ${developBranch}`);

    return unreleasedShas;
  } catch (error) {
    console.log(`Error comparing branches: ${error.message}`);
    return new Set();
  }
}

/**
 * Extract released PR numbers from main branch commit messages (method 2: squash/rebase merges)
 */
async function getReleasedPRNumbers(github, owner, repo, mainBranch) {
  try {
    // Get all commits on the main branch (up to 1000)
    const commits = await github.paginate(
      github.rest.repos.listCommits,
      {
        owner,
        repo,
        sha: mainBranch,
        per_page: 100
      },
      (response) => response.data.slice(0, 1000)
    );

    const releasedPRs = new Set();

    // Extract PR numbers from commit messages
    // Common GitHub patterns:
    // - "Title (#123)" - squash merge
    // - "Merge pull request #123" - merge commit
    // - "Title #123" - other
    const prPatterns = [
      /\(#(\d+)\)/g,           // (#123)
      /#(\d+)/g,               // #123
      /pull request #(\d+)/gi  // pull request #123
    ];

    for (const commit of commits) {
      const message = commit.commit.message;

      for (const pattern of prPatterns) {
        let match;
        while ((match = pattern.exec(message)) !== null) {
          const prNumber = parseInt(match[1], 10);
          releasedPRs.add(prNumber);
        }
      }
    }

    console.log(`Found ${releasedPRs.size} released PR numbers in ${mainBranch} branch commits`);
    console.log(`Released PRs: ${Array.from(releasedPRs).sort((a, b) => a - b).join(', ')}`);

    return releasedPRs;
  } catch (error) {
    console.log(`Error getting released PR numbers: ${error.message}`);
    return new Set();
  }
}

/**
 * Filter PRs not included in main (hybrid detection)
 */
async function filterUnreleasedPRs(github, owner, repo, mainBranch, developBranch, mainCommit, allPRs) {
  // If main branch does not exist, all PRs are unreleased
  if (mainCommit === null) {
    console.log(`Found ${allPRs.length} unreleased PRs`);
    return allPRs;
  }

  // Method 1: commit SHA matching (for standard merge commits)
  const unreleasedCommitShas = await getUnreleasedCommitShas(github, owner, repo, mainBranch, developBranch);

  // Method 2: PR reference extraction (for squash/rebase merges)
  const releasedPRNumbers = await getReleasedPRNumbers(github, owner, repo, mainBranch);

  // Hybrid decision: check both conditions
  const unreleasedPRs = allPRs.filter(pr => {
    // Skip if PR number is null or undefined
    if (!pr.number) {
      console.log(`Skipping PR without number: ${pr.title}`);
      return false;
    }

    // Skip if merge_commit_sha is null (not merged yet)
    if (!pr.merge_commit_sha) {
      console.log(`Skipping PR #${pr.number} without merge_commit_sha`);
      return false;
    }

    // Method 1: check if commit SHA is still not included in main
    const commitInDiff = unreleasedCommitShas.has(pr.merge_commit_sha);

    // Method 2: check if PR number is not in main commit messages
    const prNumberInMain = releasedPRNumbers.has(pr.number);

    // Hybrid decision:
    // - commit SHA exists in the diff (standard merge commit)
    // - and PR number is not found in main commits (not released via squash/rebase)
    const isUnreleased = commitInDiff && !prNumberInMain;

    // Debug log
    console.log(`PR #${pr.number}: commitInDiff=${commitInDiff}, prNumberInMain=${prNumberInMain}, isUnreleased=${isUnreleased}`);

    if (!isUnreleased) {
      if (prNumberInMain) {
        console.log(`  → PR #${pr.number} is released (found in main commits)`);
      } else if (!commitInDiff) {
        console.log(`  → PR #${pr.number} commit is in main (merge commit)`);
      }
    }

    return isUnreleased;
  });

  console.log(`Found ${unreleasedPRs.length} unreleased PRs`);
  return unreleasedPRs;
}

/**
 * Generate a table of unreleased PRs
 */
function generatePRTable(unreleasedPRs, developBranch, mainBranch) {
  if (unreleasedPRs.length === 0) {
    return `_There are currently no unreleased changes. All changes have been released to the ${mainBranch} branch._ ✨\n\n`;
  }

  let table = `List of PRs merged into the ${developBranch} branch but not yet released to the ${mainBranch} branch:\n\n`;
  table += '| PR | Title | Author | Merged At |\n';
  table += '|---|---|---|---|\n';

  // Sort by date (newest first)
  unreleasedPRs.sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at));

  for (const pr of unreleasedPRs) {
    const mergedAt = new Date(pr.merged_at).toISOString().replace('T', ' ').substring(0, 16);
    table += `| [#${pr.number}](${pr.html_url}) | ${pr.title} | @${pr.user.login} | ${mergedAt} |\n`;
  }

  return table + '\n';
}

/**
 * Generate the action section
 */
function generateActionSection(unreleasedPRs, owner, repo, developBranch, mainBranch) {
  if (unreleasedPRs.length === 0) {
    return '_No releasable changes, so creating a PR is not necessary._\n\n';
  }

  const releaseTitle = encodeURIComponent(`Release: ${developBranch} → ${mainBranch}`);
  const releaseBody = encodeURIComponent(`## Release Contents\n\n${unreleasedPRs.map(pr => `- #${pr.number}: ${pr.title}`).join('\n')}\n\n---\n\nThis release includes ${unreleasedPRs.length} PR(s).`);

  return `[→ Create a ${developBranch} → ${mainBranch} PR](https://github.com/${owner}/${repo}/compare/${mainBranch}...${developBranch}?expand=1&title=${releaseTitle}&body=${releaseBody})\n\n`;
}

/**
 * Generate the issue body
 */
function generateIssueBody(unreleasedPRs, owner, repo, developBranch, mainBranch, context) {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let issueBody = '## 📋 Unreleased Changes\n\n';
  issueBody += generatePRTable(unreleasedPRs, developBranch, mainBranch);
  issueBody += '## 🚀 Actions\n\n';
  issueBody += generateActionSection(unreleasedPRs, owner, repo, developBranch, mainBranch);
  issueBody += '---\n';
  issueBody += `📅 Last updated: ${now} UTC\n`;
  issueBody += `🔄 Trigger: ${context.eventName}\n`;
  issueBody += `🌿 Target branches: ${developBranch} → ${mainBranch}\n`;

  return issueBody;
}

/**
 * Create or update the dashboard issue
 */
async function updateDashboardIssue(github, owner, repo, issueBody) {
  // Find existing dashboard issue
  const existingIssues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    labels: DASHBOARD_LABEL,
    state: 'open',
    per_page: 100
  });

  const dashboardIssue = existingIssues.find(issue => !issue.pull_request && issue.title === DASHBOARD_TITLE);

  // Update if an existing issue is found
  if (dashboardIssue) {
    console.log(`Updating existing dashboard issue #${dashboardIssue.number}`);
    await github.rest.issues.update({
      owner,
      repo,
      issue_number: dashboardIssue.number,
      body: issueBody
    });
    console.log(`✅ Dashboard updated: ${dashboardIssue.html_url}`);
    return;
  }

  // Otherwise create a new one
  console.log('Creating new dashboard issue');
  const newIssue = await github.rest.issues.create({
    owner,
    repo,
    title: DASHBOARD_TITLE,
    body: issueBody,
    labels: [DASHBOARD_LABEL]
  });
  console.log(`✅ Dashboard created: ${newIssue.data.html_url}`);
}

/**
 * Main entry point
 */
module.exports = async ({ github, context, developBranch = 'develop', mainBranch = 'main' }) => {
  // Event condition check
  if (!shouldExecute(context)) {
    return;
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  console.log('Starting Release Dashboard update...');
  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Develop branch: ${developBranch}`);
  console.log(`Main branch: ${mainBranch}`);

  // If a merge to main is detected, clear the dashboard
  if (isMainBranchMerge(context, mainBranch)) {
    console.log('Clearing dashboard - all changes have been released to main');
    const issueBody = generateIssueBody([], owner, repo, developBranch, mainBranch, context);
    await updateDashboardIssue(github, owner, repo, issueBody);
    console.log('✅ Release Dashboard cleared!');
    return;
  }

  // 1. Get the latest commit on the main branch
  const mainCommit = await getMainBranchCommit(github, owner, repo, mainBranch);

  // 2. Get PRs merged into the develop branch
  const allPRs = await getMergedPRs(github, owner, repo, developBranch);

  // 3. Filter PRs not included in main
  const unreleasedPRs = await filterUnreleasedPRs(github, owner, repo, mainBranch, developBranch, mainCommit, allPRs);

  // 4. Generate the issue body
  const issueBody = generateIssueBody(unreleasedPRs, owner, repo, developBranch, mainBranch, context);

  // 5. Create or update the dashboard issue
  await updateDashboardIssue(github, owner, repo, issueBody);

  console.log('Release Dashboard update completed!');
};

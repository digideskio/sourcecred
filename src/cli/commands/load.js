// @flow

import {Command, flags} from "@oclif/command";
import mkdirp from "mkdirp";
import path from "path";

import {loadGithubData} from "../../plugins/github/loadGithubData";
import {loadGitData} from "../../plugins/git/loadGitData";
import {
  pluginNames,
  nodeMaxOldSpaceSizeFlag,
  sourcecredDirectoryFlag,
} from "../common";

const execDependencyGraph = require("../../tools/execDependencyGraph").default;

export default class PluginGraphCommand extends Command {
  static description = "load data required for SourceCred";

  static args = [
    {
      name: "repo_owner",
      required: true,
      description: "owner of the GitHub repository for which to fetch data",
    },
    {
      name: "repo_name",
      required: true,
      description: "name of the GitHub repository for which to fetch data",
    },
  ];

  static flags = {
    plugin: flags.string({
      description: "plugin whose data to load (loads all plugins if not set)",
      required: false,
      options: pluginNames(),
    }),
    "sourcecred-directory": sourcecredDirectoryFlag(),
    "max-old-space-size": nodeMaxOldSpaceSizeFlag(),
    "github-token": flags.string({
      description:
        "a GitHub API token, as generated at " +
        "https://github.com/settings/tokens/new" +
        "; required only if using the GitHub plugin",
      env: "SOURCECRED_GITHUB_TOKEN",
    }),
  };

  async run() {
    const {
      args: {repo_owner: repoOwner, repo_name: repoName},
      flags: {
        "github-token": githubToken,
        "sourcecred-directory": basedir,
        "max-old-space-size": maxOldSpaceSize,
        plugin,
      },
    } = this.parse(PluginGraphCommand);
    if (!plugin) {
      loadAllPlugins({
        basedir,
        plugin,
        repoOwner,
        repoName,
        githubToken,
        maxOldSpaceSize,
      });
    } else {
      loadPlugin({basedir, plugin, repoOwner, repoName, githubToken});
    }
  }
}

function loadAllPlugins({repoOwner, repoName, githubToken, maxOldSpaceSize}) {
  if (githubToken == null) {
    // TODO: This check should be abstracted so that plugins can
    // specify their argument dependencies and get nicely
    // formatted errors.
    console.error("fatal: No GitHub token specified. Try `--help'.");
    process.exitCode = 1;
    return;
  }
  const tasks = [
    ...pluginNames().map((pluginName) => ({
      id: `load-${pluginName}`,
      cmd: [
        "node",
        `--max_old_space_size=${maxOldSpaceSize}`,
        "./bin/sourcecred.js",
        "load",
        repoOwner,
        repoName,
        "--plugin",
        pluginName,
        "--github-token",
        githubToken,
      ],
      deps: [],
    })),
  ];
  execDependencyGraph(tasks, {taskPassLabel: "DONE"}).then(({success}) => {
    process.exitCode = success ? 0 : 1;
  });
}

function loadPlugin({basedir, plugin, repoOwner, repoName, githubToken}) {
  const outputDirectory = path.join(
    basedir,
    "data",
    repoOwner,
    repoName,
    plugin
  );
  mkdirp.sync(outputDirectory);
  switch (plugin) {
    case "github":
      if (githubToken == null) {
        // TODO: This check should be abstracted so that plugins can
        // specify their argument dependencies and get nicely
        // formatted errors.
        console.error("fatal: No GitHub token specified. Try `--help'.");
        process.exitCode = 1;
        return;
      } else {
        loadGithubData({
          token: githubToken,
          repoOwner,
          repoName,
          outputDirectory,
        });
      }
      break;
    case "git":
      loadGitData({repoOwner, repoName, outputDirectory});
      break;
    default:
      console.error("fatal: Unknown plugin: " + (plugin: empty));
      process.exitCode = 1;
      return;
  }
}

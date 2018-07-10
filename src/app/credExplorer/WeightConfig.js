// @flow

import React from "react";

import {
  type EdgeAddressT,
  type NodeAddressT,
  EdgeAddress,
  NodeAddress,
} from "../../core/graph";

import {edgeByPrefix, nodeByPrefix} from "./edgeWeights";
import {
  type EdgeEvaluator,
  composeNodeEvaluators,
  liftNodeEvaluator,
} from "../../core/attribution/weights";
import LocalStore from "./LocalStore";
import * as MapUtil from "../../util/map";
import * as NullUtil from "../../util/null";

// Hacks...
import type {PluginAdapter} from "../pluginAdapter";
import * as GithubNode from "../../plugins/github/nodes";
import * as R from "../../plugins/github/relationalView";
import * as GithubEdge from "../../plugins/github/edges";
import * as GitNode from "../../plugins/git/nodes";
import * as GitEdge from "../../plugins/git/edges";
type Props = {
  onChange: (EdgeEvaluator) => void,
  adapters: ?$ReadOnlyArray<PluginAdapter>,
};

// The key should be an EdgeAddressT, but a Flow bug prevents this.
type EdgeWeights = Map<EdgeAddressT, UserEdgeWeight>;
type UserEdgeWeight = {|+logWeight: number, +directionality: number|};
const EDGE_WEIGHTS_KEY = "edgeWeights";
const defaultEdgeWeights = (): EdgeWeights =>
  new Map()
    .set(GithubEdge._Prefix.authors, {logWeight: 0, directionality: 0.5})
    .set(GithubEdge._Prefix.mergedAs, {logWeight: 0, directionality: 0.5})
    .set(GithubEdge._Prefix.references, {logWeight: 0, directionality: 0.5})
    .set(GithubEdge._Prefix.hasParent, {logWeight: 0, directionality: 0.5})
    .set(GitEdge._Prefix.hasTree, {logWeight: 0, directionality: 0.5})
    .set(GitEdge._Prefix.hasParent, {logWeight: 0, directionality: 0.5})
    .set(GitEdge._Prefix.includes, {logWeight: 0, directionality: 0.5})
    .set(GitEdge._Prefix.becomes, {logWeight: 0, directionality: 0.5})
    .set(GitEdge._Prefix.hasContents, {logWeight: 0, directionality: 0.5});

type NodeWeights = Map<NodeAddressT, UserNodeWeight>;
type UserNodeWeight = number /* in log space */;
const NODE_WEIGHTS_KEY = "nodeWeights";
const defaultNodeWeights = (): NodeWeights =>
  new Map()
    .set(GithubNode._Prefix.repo, 0)
    .set(GithubNode._Prefix.issue, 0)
    .set(GithubNode._Prefix.pull, 0)
    .set(GithubNode._Prefix.review, 0)
    .set(GithubNode._Prefix.comment, 0)
    .set(GithubNode._Prefix.userlike, 0)
    .set(GitNode._Prefix.blob, 0)
    .set(GitNode._Prefix.commit, 0)
    .set(GitNode._Prefix.tree, 0)
    .set(GitNode._Prefix.treeEntry, 0);

type HeuristicConfig = {|
  +enabled: boolean,
  +multiply: number,
  +add: number,
|};

const defaultConfig = () => ({enabled: false, multiply: 1, add: 0});

type GithubHeuristics = {|
  +pullAdditions: HeuristicConfig,
  +pullDeletions: HeuristicConfig,
  +pullNetAdditions: HeuristicConfig,
  +pullNetDeletions: HeuristicConfig,
  +pullDelta: HeuristicConfig,
|};
const GITHUB_HEURISTICS_KEY = "githubHeuristics";

const defaultGithubHeuristics = (): GithubHeuristics => ({
  pullAdditions: defaultConfig(),
  pullDeletions: defaultConfig(),
  pullNetAdditions: defaultConfig(),
  pullNetDeletions: defaultConfig(),
  pullDelta: defaultConfig(),
});

type State = {
  edgeWeights: EdgeWeights,
  nodeWeights: NodeWeights,
  githubHeuristics: GithubHeuristics,
};

export class WeightConfig extends React.Component<Props, State> {
  constructor(props: Props): void {
    super(props);
    this.state = {
      edgeWeights: defaultEdgeWeights(),
      nodeWeights: defaultNodeWeights(),
      githubHeuristics: defaultGithubHeuristics(),
    };
  }

  componentDidMount() {
    this.setState(
      (state) => {
        return {
          edgeWeights: NullUtil.orElse(
            NullUtil.map(LocalStore.get(EDGE_WEIGHTS_KEY), MapUtil.fromObject),
            state.edgeWeights
          ),
          nodeWeights: NullUtil.orElse(
            NullUtil.map(LocalStore.get(NODE_WEIGHTS_KEY), MapUtil.fromObject),
            state.nodeWeights
          ),
          githubHeuristics: NullUtil.orElse(
            LocalStore.get(GITHUB_HEURISTICS_KEY),
            state.githubHeuristics
          ),
        };
      },
      () => this.fire()
    );
  }

  render() {
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <EdgeConfig
          edgeWeights={this.state.edgeWeights}
          onChange={(ew) => this.setState({edgeWeights: ew}, () => this.fire())}
        />
        <div>
          <NodeConfig
            nodeWeights={this.state.nodeWeights}
            onChange={(nw) =>
              this.setState({nodeWeights: nw}, () => this.fire())
            }
          />
          <GithubHeuristicConfig
            githubHeuristics={this.state.githubHeuristics}
            onChange={(h) =>
              this.setState({githubHeuristics: h}, () => this.fire())
            }
          />
        </div>
      </div>
    );
  }

  fire() {
    const {edgeWeights, nodeWeights, githubHeuristics} = this.state;
    LocalStore.set(EDGE_WEIGHTS_KEY, MapUtil.toObject(edgeWeights));
    LocalStore.set(NODE_WEIGHTS_KEY, MapUtil.toObject(nodeWeights));
    LocalStore.set(GITHUB_HEURISTICS_KEY, githubHeuristics);
    const edgePrefixes = Array.from(edgeWeights.entries()).map(
      ([prefix, {logWeight, directionality}]) => ({
        prefix,
        weight: 2 ** logWeight,
        directionality,
      })
    );
    const nodePrefixes = Array.from(nodeWeights.entries()).map(
      ([prefix, logWeight]) => ({
        prefix,
        weight: 2 ** logWeight,
      })
    );
    let nodeEvaluator = nodeByPrefix(nodePrefixes);
    if (this.props.adapters != null) {
      const githubAdapter = this.props.adapters.find(
        (x) => x.name() === "GitHub"
      );
      if (githubAdapter == null) {
        throw new Error("No Github adapter");
      }
      const view: R.RelationalView = (githubAdapter: any)._view;
      function addPullEvaluator(
        heuristics: HeuristicConfig,
        fn: (R.Pull) => number
      ) {
        if (heuristics.enabled) {
          const evaluator = (n: NodeAddressT) => {
            if (NodeAddress.hasPrefix(n, GithubNode._Prefix.pull)) {
              const pullAddress: GithubNode.PullAddress = (GithubNode.fromRaw(
                (n: any)
              ): any);
              const pull = view.pull(pullAddress);
              if (pull == null) {
                throw new Error("Bad pull for ${JSON.stringify(pullAddress)}");
              }
              return fn(pull) * heuristics.multiply + heuristics.add;
            } else {
              return 0;
            }
          };
          nodeEvaluator = composeNodeEvaluators(nodeEvaluator, evaluator);
        }
      }
      function additionsDeletionsEvaluator(
        heuristics: HeuristicConfig,
        fn: ({a: number, d: number}) => number
      ) {
        const handler = (p: R.Pull) => {
          const a = p.additions();
          const d = p.deletions();
          return fn({a, d});
        };
        addPullEvaluator(heuristics, handler);
      }
      function friendlyLog(x) {
        if (x <= 1) {
          return 0;
        }
        return Math.log(x);
      }
      const ghh = this.state.githubHeuristics;
      additionsDeletionsEvaluator(ghh.pullAdditions, ({a}) => friendlyLog(a));
      additionsDeletionsEvaluator(ghh.pullDeletions, ({d}) => friendlyLog(d));
      additionsDeletionsEvaluator(ghh.pullNetAdditions, ({a, d}) =>
        friendlyLog(a - d)
      );
      additionsDeletionsEvaluator(ghh.pullNetDeletions, ({a, d}) =>
        friendlyLog(d - a)
      );
      additionsDeletionsEvaluator(ghh.pullDelta, ({a, d}) =>
        friendlyLog(a + d)
      );
    }

    const edgeEvaluator = edgeByPrefix(edgePrefixes);
    const composedEvaluator = liftNodeEvaluator(nodeEvaluator, edgeEvaluator);
    // TODO: Refactor this so that we return the raw weights rather than a
    // composed evaluator. This way, code that has access to the GitHub
    // relational view can make use of the GitHub heuristics.
    this.props.onChange(composedEvaluator);
  }
}

class EdgeConfig extends React.Component<{
  edgeWeights: EdgeWeights,
  onChange: (EdgeWeights) => void,
}> {
  weightControls() {
    return Array.from(this.props.edgeWeights.entries()).map(([key, datum]) => (
      <label style={{display: "block"}} key={key}>
        <input
          type="range"
          min={-10}
          max={10}
          step={0.1}
          value={datum.logWeight}
          onChange={(e) => {
            const value: number = e.target.valueAsNumber;
            const edgeWeights = MapUtil.copy(this.props.edgeWeights).set(key, {
              ...datum,
              logWeight: value,
            });
            this.props.onChange(edgeWeights);
          }}
        />{" "}
        {formatNumber(datum.logWeight)}{" "}
        {JSON.stringify(EdgeAddress.toParts(key))}
      </label>
    ));
  }

  directionControls() {
    return Array.from(this.props.edgeWeights.entries()).map(([key, datum]) => (
      <label style={{display: "block"}} key={key}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={datum.directionality}
          onChange={(e) => {
            const value: number = e.target.valueAsNumber;
            const edgeWeights = MapUtil.copy(this.props.edgeWeights).set(key, {
              ...datum,
              directionality: value,
            });
            this.props.onChange(edgeWeights);
          }}
        />{" "}
        {datum.directionality.toFixed(2)}{" "}
        {JSON.stringify(EdgeAddress.toParts(key))}
      </label>
    ));
  }
  render() {
    return (
      <div>
        <h2>Edge weights (in log space)</h2>
        {this.weightControls()}
        <h2>Edge directionality</h2>
        {this.directionControls()}
      </div>
    );
  }
}

class NodeConfig extends React.Component<{
  nodeWeights: NodeWeights,
  onChange: (NodeWeights) => void,
}> {
  render() {
    const controls = Array.from(this.props.nodeWeights.entries()).map(
      ([key, currentValue]) => (
        <label style={{display: "block"}} key={key}>
          <input
            type="range"
            min={-10}
            max={10}
            step={0.1}
            value={currentValue}
            onChange={(e) => {
              const value: number = e.target.valueAsNumber;
              const nodeWeights = MapUtil.copy(this.props.nodeWeights).set(
                key,
                value
              );
              this.props.onChange(nodeWeights);
            }}
          />{" "}
          {formatNumber(currentValue)}{" "}
          {JSON.stringify(NodeAddress.toParts(key))}
        </label>
      )
    );
    return (
      <div>
        <h2>Node weights (in log space)</h2>
        {controls}
      </div>
    );
  }
}

class GithubHeuristicConfig extends React.Component<{|
  +githubHeuristics: GithubHeuristics,
  +onChange: (GithubHeuristics) => void,
|}> {
  heuristicControls(key: string, {enabled, multiply, add}: HeuristicConfig) {
    return (
      <tr key={key}>
        <td>{key}</td>
        <td>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => {
                const heuristics = {
                  ...this.props.githubHeuristics,
                  [key]: {enabled: !enabled, multiply, add},
                };
                this.props.onChange(heuristics);
              }}
            />
          </label>
        </td>
        <td>
          <label>
            <input
              type="number"
              value={multiply}
              onChange={(e) => {
                const value: number = e.target.valueAsNumber;
                const heuristics = {
                  ...this.props.githubHeuristics,
                  [key]: {enabled, multiply: value, add},
                };
                this.props.onChange(heuristics);
              }}
            />{" "}
          </label>
        </td>
        <td>
          <label>
            <input
              type="number"
              value={add}
              onChange={(e) => {
                const value: number = e.target.valueAsNumber;
                const heuristics = {
                  ...this.props.githubHeuristics,
                  [key]: {enabled, multiply, add: value},
                };
                this.props.onChange(heuristics);
              }}
            />{" "}
          </label>
        </td>
      </tr>
    );
  }

  render() {
    const controls = Object.keys(this.props.githubHeuristics).map((k) =>
      this.heuristicControls(k, this.props.githubHeuristics[k])
    );
    return (
      <div>
        <h2>Hacky GitHub Heuristics</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Enabled</th>
              <th>*</th>
              <th>+</th>
            </tr>
          </thead>
          <tbody>{controls}</tbody>
        </table>
      </div>
    );
  }
}

function formatNumber(n: number) {
  let x = n.toFixed(1);
  if (!x.startsWith("-")) {
    x = "+" + x;
  }
  return x.replace("-", "\u2212");
}

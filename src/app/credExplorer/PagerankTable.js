// @flow

import sortBy from "lodash.sortby";
import React from "react";

import {
  Graph,
  NodeAddress,
  type NodeAddressT,
  type Neighbor,
  Direction,
  type Edge,
  EdgeAddress,
  type EdgeAddressT,
} from "../../core/graph";
import type {PagerankResult} from "../../core/attribution/pagerank";
import type {PluginAdapter} from "../pluginAdapter";

const MAX_TABLE_ENTRIES = 100;

type Props = {
  pagerankResult: ?PagerankResult,
  graph: ?Graph,
  adapters: ?$ReadOnlyArray<PluginAdapter>,
  nodeToContributions: NodeToContributions,
};

type State = {
  topLevelFilter: NodeAddressT,
};

// TODO: Factor this out and test it (#465)
export function nodeDescription(
  address: NodeAddressT,
  adapters: $ReadOnlyArray<PluginAdapter>
): string {
  const adapter = adapters.find((adapter) =>
    NodeAddress.hasPrefix(address, adapter.nodePrefix())
  );
  if (adapter == null) {
    const result = NodeAddress.toString(address);
    console.warn(`No adapter for ${result}`);
    return result;
  }

  try {
    return adapter.renderer().nodeDescription(address);
  } catch (e) {
    const result = NodeAddress.toString(address);
    console.error(`Error getting description for ${result}: ${e.message}`);
    return result;
  }
}

function edgeVerb(
  address: EdgeAddressT,
  direction: "FORWARD" | "BACKWARD",
  adapters: $ReadOnlyArray<PluginAdapter>
): string {
  const adapter = adapters.find((adapter) =>
    EdgeAddress.hasPrefix(address, adapter.edgePrefix())
  );
  if (adapter == null) {
    const result = EdgeAddress.toString(address);
    console.warn(`No adapter for ${result}`);
    return result;
  }

  try {
    return adapter.renderer().edgeVerb(address, direction);
  } catch (e) {
    const result = EdgeAddress.toString(address);
    console.error(`Error getting description for ${result}: ${e.message}`);
    return result;
  }
}

function neighborVerb(
  {node, edge}: Neighbor,
  adapters: $ReadOnlyArray<PluginAdapter>
): string {
  const forwardVerb = edgeVerb(edge.address, "FORWARD", adapters);
  const backwardVerb = edgeVerb(edge.address, "BACKWARD", adapters);
  if (edge.src === edge.dst) {
    return `${forwardVerb} and ${backwardVerb}`;
  } else if (edge.dst === node) {
    return forwardVerb;
  } else {
    return backwardVerb;
  }
}

export function contributionVerb(
  target: NodeAddressT,
  contribution: Contribution,
  adapters: $ReadOnlyArray<PluginAdapter>
): string {
  switch (contribution.type) {
    case "NEIGHBOR":
      return neighborVerb(contribution.neighbor, adapters);
    case "SYNTHETIC_LOOP":
      return "[synthetic loop]";
    default:
      throw new Error((contribution.type: empty));
  }
}

export class PagerankTable extends React.PureComponent<Props, State> {
  constructor() {
    super();
    this.state = {topLevelFilter: NodeAddress.empty};
  }

  render() {
    if (this.props.graph == null || this.props.adapters == null) {
      return <p>You must load a graph before seeing PageRank analysis.</p>;
    }
    if (this.props.pagerankResult == null) {
      return <p>Please run PageRank to see analysis.</p>;
    }
    return (
      <div>
        <h2>Contributions</h2>
        {this.renderFilterSelect()}
        {this.renderTable()}
      </div>
    );
  }

  renderFilterSelect() {
    const {graph, pagerankResult, adapters} = this.props;
    if (graph == null || pagerankResult == null || adapters == null) {
      throw new Error("Impossible.");
    }

    function optionGroup(adapter: PluginAdapter) {
      const header = (
        <option
          key={adapter.nodePrefix()}
          value={adapter.nodePrefix()}
          style={{fontWeight: "bold"}}
        >
          {adapter.name()}
        </option>
      );
      const entries = adapter.nodeTypes().map((type) => (
        <option key={type.prefix} value={type.prefix}>
          {"\u2003" + type.name}
        </option>
      ));
      return [header, ...entries];
    }
    return (
      <label>
        Filter by contribution type:{" "}
        <select
          value={this.state.topLevelFilter}
          onChange={(e) => {
            this.setState({topLevelFilter: e.target.value});
          }}
        >
          <option value={NodeAddress.empty}>Show all</option>
          {sortBy(adapters, (a) => a.name()).map(optionGroup)}
        </select>
      </label>
    );
  }

  renderTable() {
    const {graph, pagerankResult, adapters, nodeToContributions} = this.props;
    if (graph == null || pagerankResult == null || adapters == null) {
      throw new Error("Impossible.");
    }
    const topLevelFilter = this.state.topLevelFilter;
    return (
      <table
        style={{
          borderCollapse: "collapse",
          marginTop: 10,
          // If we don't subtract 1px here, then a horizontal scrollbar
          // appears in Chrome (but not Firefox). I'm not sure why.
          width: "calc(100% - 1px)",
        }}
      >
        <thead>
          <tr>
            <th style={{textAlign: "left"}}>Node</th>
            <th style={{textAlign: "right"}}>log(contribution)</th>
            <th style={{textAlign: "right"}}>log(score)</th>
          </tr>
        </thead>
        <tbody>
          <NodesTables
            addresses={
              topLevelFilter == null
                ? Array.from(graph.nodes())
                : Array.from(graph.nodes()).filter((node) =>
                    NodeAddress.hasPrefix(node, topLevelFilter)
                  )
            }
            graph={graph}
            pagerankResult={pagerankResult}
            depth={0}
            adapters={adapters}
            nodeToContributions={nodeToContributions}
          />
        </tbody>
      </table>
    );
  }
}

type RTState = {expanded: boolean};
type RTProps = {|
  +node: NodeAddressT,
  // Present if this RT shows a neighbor (not a top-level node)
  +contribution: Contribution,
  +graph: Graph,
  +pagerankResult: PagerankResult,
  +depth: number,
  +adapters: $ReadOnlyArray<PluginAdapter>,
  +nodeToContributions: NodeToContributions,
|};

class RecursiveTable extends React.PureComponent<RTProps, RTState> {
  constructor() {
    super();
    this.state = {expanded: false};
  }

  render() {
    const {
      node,
      contribution,
      adapters,
      depth,
      graph,
      pagerankResult,
      nodeToContributions,
    } = this.props;
    const {expanded} = this.state;
    const probability = pagerankResult.get(node);
    if (probability == null) {
      throw new Error(`no PageRank value for ${NodeAddress.toString(node)}`);
    }
    const modifiedLogScore = Math.log(probability) + 10;
    const logScoreString = modifiedLogScore.toFixed(2);
    let contributionVerbString = null;
    let logContributionScoreString = null;
    if (contribution != null) {
      const contribScore = contributionScore(
        node,
        contribution,
        pagerankResult
      );
      const modifiedLogContribScore = Math.log(contribScore) + 10;
      logContributionScoreString = modifiedLogContribScore.toFixed(2);
      contributionVerbString = contributionVerb(node, contribution, adapters);
    }

    return [
      <tr
        key="self"
        style={{backgroundColor: `rgba(0,143.4375,0,${1 - 0.9 ** depth})`}}
      >
        <td style={{display: "flex", alignItems: "flex-start"}}>
          <button
            style={{
              marginRight: 5,
              marginLeft: 15 * depth,
            }}
            onClick={() => {
              this.setState(({expanded}) => ({
                expanded: !expanded,
              }));
            }}
          >
            {expanded ? "\u2212" : "+"}
          </button>
          <span>
            {contributionVerbString != null && (
              <React.Fragment>
                <span
                  style={{
                    display: "inline-block",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    fontSize: "smaller",
                  }}
                >
                  {contributionVerbString}
                </span>{" "}
              </React.Fragment>
            )}
            {nodeDescription(node, adapters)}
          </span>
        </td>
        <td style={{textAlign: "right"}}>
          {logContributionScoreString ? logContributionScoreString : "—"}
        </td>
        <td style={{textAlign: "right"}}>{logScoreString}</td>
      </tr>,
      expanded && (
        <NeighborsTables
          key="children"
          nodeToContributions={nodeToContributions}
          target={node}
          graph={graph}
          pagerankResult={pagerankResult}
          depth={depth + 1}
          adapters={adapters}
        />
      ),
    ];
  }
}

type NodesTablesProps = {|
  +addresses: $ReadOnlyArray<NodeAddressT>,
  +graph: Graph,
  +pagerankResult: PagerankResult,
  +depth: number,
  +adapters: $ReadOnlyArray<PluginAdapter>,
  +nodeToContributions: NodeToContributions,
|};

class NodesTables extends React.PureComponent<NodesTablesProps> {
  render() {
    const {
      addresses,
      graph,
      pagerankResult,
      depth,
      adapters,
      nodeToContributions,
    } = this.props;
    return sortBy(
      addresses,
      (x) => {
        const p = pagerankResult.get(x);
        if (p == null) {
          throw new Error(`No pagerank result for ${NodeAddress.toString(x)}`);
        }
        return -p;
      },
      (x) => x
    )
      .slice(0, MAX_TABLE_ENTRIES)
      .map((address) => (
        <RecursiveTable
          depth={depth}
          node={address}
          contribution={null}
          graph={graph}
          pagerankResult={pagerankResult}
          key={address}
          adapters={adapters}
          nodeToContributions={nodeToContributions}
        />
      ));
  }
}

type NeighborsTablesProps = {|
  +target: NodeAddressT,
  +graph: Graph,
  +pagerankResult: PagerankResult,
  +depth: number,
  +adapters: $ReadOnlyArray<PluginAdapter>,
  +nodeToContributions: NodeToContributions,
|};

function contributionScore(target, contribution, pagerankResult) {
  const source = sourceForContributor(contribution.contributor, target);
  const sourceScore = pagerankResult.get(source);
  if (sourceScore == null) {
    throw new Error(`No pagerank result for ${NodeAddress.toString(source)}`);
  }
  return sourceScore * contribution.weight;
}

function contributionKey(target, contribution): string {
  switch (contribution.type) {
    case "NEIGHBOR":
      return contribution.contributor.edge.address;
    case "SYNTHETIC_LOOP":
      // guaranteed not to conflict, as this is not an EdgeAddressT
      return contribution.type;
    default:
      throw new Error((contribution.type: empty));
  }
}

class NeighborsTables extends React.PureComponent<NeighborsTablesProps> {
  render() {
    const {
      graph,
      pagerankResult,
      target,
      nodeToContributions,
      depth,
      adapters,
    } = this.props;
    const contributionsForTarget = nodeToContributions.get(target);
    if (contributionsForTarget == null) {
      throw new Error(
        `Couldn't find contributions for ${NodeAddress.toString(target)}`
      );
    }
    return sortBy(
      contributionsForTarget,
      (contribution) => contributionScore(target, contribution, pagerankResult),
      (contribution) => contributionKey(target, contribution)
    )
      .slice(0, MAX_TABLE_ENTRIES)
      .map((contribution) => (
        <RecursiveTable
          depth={depth}
          node={target}
          contribution={contribution}
          graph={graph}
          nodeToContributions={nodeToContributions}
          pagerankResult={pagerankResult}
          key={contributionKey(target, contribution)}
          adapters={adapters}
        />
      ));
  }
}

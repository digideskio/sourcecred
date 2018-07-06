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
import type {
  PagerankResult,
  PagerankResultAndContributions,
} from "../../core/attribution/pagerank";
import type {PluginAdapter} from "../pluginAdapter";
import {
  contributorSource,
  type NodeToContributions,
  type Contribution,
} from "../../core/attribution/graphToMarkovChain";

const MAX_TABLE_ENTRIES = 100;

type Props = {
  pagerankResultAndContributions: ?PagerankResultAndContributions,
  graph: ?Graph,
  adapters: ?$ReadOnlyArray<PluginAdapter>,
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

export function contributionVerb(
  target: NodeAddressT,
  contribution: Contribution,
  adapters: $ReadOnlyArray<PluginAdapter>
): string {
  switch (contribution.contributor.type) {
    case "IN_EDGE":
      return edgeVerb(
        contribution.contributor.edge.address,
        "BACKWARD",
        adapters
      );
    case "OUT_EDGE":
      return edgeVerb(
        contribution.contributor.edge.address,
        "FORWARD",
        adapters
      );
    case "SYNTHETIC_LOOP":
      return "[synthetic loop]";
    default:
      throw new Error((contribution.contributor.type: empty));
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
    if (this.props.pagerankResultAndContributions == null) {
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
    const {graph, pagerankResultAndContributions, adapters} = this.props;
    if (
      graph == null ||
      pagerankResultAndContributions == null ||
      adapters == null
    ) {
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
    const {graph, pagerankResultAndContributions, adapters} = this.props;
    if (
      graph == null ||
      pagerankResultAndContributions == null ||
      adapters == null
    ) {
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
            pagerankResultAndContributions={pagerankResultAndContributions}
            depth={0}
            adapters={adapters}
          />
        </tbody>
      </table>
    );
  }
}

type NodeRowState = {expanded: boolean};
type NodeRowProps = {|
  +node: NodeAddressT,
  +graph: Graph,
  +pagerankResultAndContributions: PagerankResultAndContributions,
  +adapters: $ReadOnlyArray<PluginAdapter>,
|};

class NodeRow extends React.PureComponent<NodeRowProps, NodeRowState> {
  constructor() {
    super();
    this.state = {expanded: false};
  }

  render() {
    const {node, adapters, graph, pagerankResultAndContributions} = this.props;
    const {expanded} = this.state;
    const {pagerankResult} = pagerankResultAndContributions;

    const p = pagerankResult.get(node);
    if (p == null) {
      throw new Error(`no PageRank value for ${NodeAddress.toString(node)}`);
    }
    const modifiedLogScore = Math.log(p) + 10;
    const logScoreString = modifiedLogScore.toFixed(2);
    const nodeDescriptionString = nodeDescription(node, adapters);

    return [
      <tr key="self">
        <td style={{display: "flex", alignItems: "flex-start"}}>
          <button
            style={{marginRight: 5}}
            onClick={() => {
              this.setState(({expanded}) => ({
                expanded: !expanded,
              }));
            }}
          >
            {expanded ? "\u2212" : "+"}
          </button>
          <span>{nodeDescriptionString}</span>
        </td>
        <td style={{textAlign: "right"}}>{"—"}</td>
        <td style={{textAlign: "right"}}>{logScoreString}</td>
      </tr>,
      expanded && (
        <ContributionRows
          key="children"
          parent={node}
          graph={graph}
          pagerankResultAndContributions={pagerankResultAndContributions}
          depth={1}
          adapters={adapters}
        />
      ),
    ];
  }
}

type ContributionRowState = {expanded: boolean};
type ContributionRowProps = {|
  +parent: NodeAddressT,
  +contribution: Contribution,
  +graph: Graph,
  +pagerankResultAndContributions: PagerankResultAndContributions,
  +depth: number,
  +adapters: $ReadOnlyArray<PluginAdapter>,
|};

class ContributionRow extends React.PureComponent<
  ContributionRowProps,
  ContributionRowState
> {
  constructor() {
    super();
    this.state = {expanded: false};
  }

  render() {
    const {
      parent,
      contribution,
      adapters,
      depth,
      graph,
      pagerankResultAndContributions,
    } = this.props;
    const {expanded} = this.state;
    const {
      pagerankResult,
      nodeToContributions,
    } = pagerankResultAndContributions;

    const source = contributorSource(parent, contribution.contributor);
    const p = pagerankResult.get(source);
    if (p == null) {
      throw new Error(`no PageRank value for ${NodeAddress.toString(source)}`);
    }
    const modifiedLogScore = Math.log(p) + 10;
    const logScoreString = modifiedLogScore.toFixed(2);
    const nodeDescriptionString = nodeDescription(source, adapters);
    const contributionScore = p * contribution.weight;
    const modifiedLogContributionScore = Math.log(contributionScore) + 10;
    const logContributionScoreString = modifiedLogContributionScore.toFixed(2);
    const contributionVerbString = contributionVerb(
      parent,
      contribution,
      adapters
    );

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
            {nodeDescriptionString}
          </span>
        </td>
        <td style={{textAlign: "right"}}>{logContributionScoreString}</td>
        <td style={{textAlign: "right"}}>{logScoreString}</td>
      </tr>,
      expanded && (
        <ContributionRows
          key="children"
          parent={source}
          graph={graph}
          pagerankResultAndContributions={pagerankResultAndContributions}
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
  +pagerankResultAndContributions: PagerankResultAndContributions,
  +depth: number,
  +adapters: $ReadOnlyArray<PluginAdapter>,
|};

class NodesTables extends React.PureComponent<NodesTablesProps> {
  render() {
    const {
      addresses,
      graph,
      pagerankResultAndContributions,
      depth,
      adapters,
    } = this.props;
    return sortBy(
      addresses,
      (x) => {
        const p = pagerankResultAndContributions.pagerankResult.get(x);
        if (p == null) {
          throw new Error(`No pagerank result for ${NodeAddress.toString(x)}`);
        }
        return -p;
      },
      (x) => x
    )
      .slice(0, MAX_TABLE_ENTRIES)
      .map((address) => (
        <NodeRow
          node={address}
          graph={graph}
          pagerankResultAndContributions={pagerankResultAndContributions}
          key={address}
          adapters={adapters}
        />
      ));
  }
}

type ContributionRowsProps = {|
  +parent: NodeAddressT,
  +graph: Graph,
  +pagerankResultAndContributions: PagerankResultAndContributions,
  +depth: number,
  +adapters: $ReadOnlyArray<PluginAdapter>,
|};

function contributionScore(target, contribution, pagerankResult) {
  const source = contributorSource(target, contribution.contributor);
  const sourceScore = pagerankResult.get(source);
  if (sourceScore == null) {
    throw new Error(`No pagerank result for ${NodeAddress.toString(source)}`);
  }
  return sourceScore * contribution.weight;
}

function contributionKey(
  target: NodeAddressT,
  contribution: Contribution
): string {
  switch (contribution.contributor.type) {
    case "IN_EDGE":
      return "IN_EDGE:" + contribution.contributor.edge.address;
    case "OUT_EDGE":
      return "OUT_EDGE:" + contribution.contributor.edge.address;
    case "SYNTHETIC_LOOP":
      return "SYNTHETIC_LOOP";
    default:
      throw new Error((contribution.contributor.type: empty));
  }
}

class ContributionRows extends React.PureComponent<ContributionRowsProps> {
  render() {
    const {
      graph,
      pagerankResultAndContributions,
      parent,
      depth,
      adapters,
    } = this.props;
    const {
      nodeToContributions,
      pagerankResult,
    } = pagerankResultAndContributions;
    const contributionsForParent = nodeToContributions.get(parent);
    if (contributionsForParent == null) {
      throw new Error(
        `Couldn't find contributions for ${NodeAddress.toString(parent)}`
      );
    }
    return sortBy(
      contributionsForParent,
      (contribution) =>
        -contributionScore(parent, contribution, pagerankResult),
      (contribution) => contributionKey(parent, contribution)
    )
      .slice(0, MAX_TABLE_ENTRIES)
      .map((contribution) => (
        <ContributionRow
          depth={depth}
          parent={parent}
          contribution={contribution}
          graph={graph}
          pagerankResultAndContributions={pagerankResultAndContributions}
          key={contributionKey(parent, contribution)}
          adapters={adapters}
        />
      ));
  }
}

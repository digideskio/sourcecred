// @flow

import sortBy from "lodash.sortby";
import React from "react";

import {
  type Edge,
  type EdgeAddressT,
  type Neighbor,
  type NodeAddressT,
  Direction,
  EdgeAddress,
  Graph,
  NodeAddress,
} from "../../core/graph";
import type {
  PagerankNodeDecomposition,
  ScoredContribution,
} from "../../core/attribution/pagerankNodeDecomposition";
import {
  type Contribution,
  contributorSource,
} from "../../core/attribution/graphToMarkovChain";
import type {PluginAdapter} from "../pluginAdapter";

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

function scoreDisplay(probability: number) {
  const modifiedLogScore = Math.log(probability) + 10;
  return modifiedLogScore.toFixed(2);
}

const MAX_TABLE_ENTRIES = 100;

type SharedProps = {|
  +pnd: PagerankNodeDecomposition,
  +adapters: $ReadOnlyArray<PluginAdapter>,
  +maxEntriesPerList: number,
|};

type PagerankTableProps = {|
  +pnd: ?PagerankNodeDecomposition,
  +adapters: ?$ReadOnlyArray<PluginAdapter>,
  +maxEntriesPerList: number,
|};
type PagerankTableState = {|topLevelFilter: NodeAddressT|};
export class PagerankTable extends React.PureComponent<
  PagerankTableProps,
  PagerankTableState
> {
  constructor() {
    super();
    this.state = {topLevelFilter: NodeAddress.empty};
  }

  render() {
    if (this.props.adapters == null) {
      return <p>You must load a graph before seeing PageRank analysis.</p>;
    }
    if (this.props.pnd == null) {
      return <p>Please run PageRank to see analysis.</p>;
    }
    if (this.props.maxEntriesPerList == null) {
      throw new Error("maxEntriesPerList not set");
    }
    return (
      <div>
        <h2>PageRank results</h2>
        {this.renderFilterSelect()}
        {this.renderTable()}
      </div>
    );
  }

  renderFilterSelect() {
    const {pnd, adapters} = this.props;
    if (pnd == null || adapters == null) {
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
        <span>Filter by node type: </span>
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
    const {pnd, adapters, maxEntriesPerList} = this.props;
    if (pnd == null || adapters == null || maxEntriesPerList == null) {
      throw new Error("Impossible.");
    }
    const topLevelFilter = this.state.topLevelFilter;
    const sharedProps = {pnd, adapters, maxEntriesPerList};
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
            <th style={{textAlign: "left"}}>Description</th>
            <th style={{textAlign: "right"}}>Contribution</th>
            <th style={{textAlign: "right"}}>Score</th>
          </tr>
        </thead>
        <tbody>
          <NodeRowList
            sharedProps={sharedProps}
            nodes={Array.from(pnd.keys()).filter((node) =>
              NodeAddress.hasPrefix(node, topLevelFilter)
            )}
          />
        </tbody>
      </table>
    );
  }
}

type NodeRowListProps = {|
  +nodes: $ReadOnlyArray<NodeAddressT>,
  +sharedProps: SharedProps,
|};

export class NodeRowList extends React.PureComponent<NodeRowListProps> {
  render() {
    const {nodes, sharedProps} = this.props;
    const {pnd, adapters, maxEntriesPerList} = sharedProps;
    return sortBy(
      nodes,
      (n) => {
        const r = pnd.get(n);
        if (r == null) {
          throw new Error(`Node ${NodeAddress.toString(n)} not found`);
        }
        return -r.score;
      },
      (n) => n
    )
      .slice(0, maxEntriesPerList)
      .map((node) => (
        <NodeRow node={node} key={node} sharedProps={sharedProps} />
      ));
  }
}

type RowState = {|
  expanded: boolean,
|};

type NodeRowProps = {|
  +node: NodeAddressT,
  +sharedProps: SharedProps,
|};

export class NodeRow extends React.PureComponent<NodeRowProps, RowState> {
  constructor() {
    super();
    this.state = {expanded: false};
  }
  render() {
    const {node, sharedProps} = this.props;
    const {pnd, adapters} = sharedProps;
    const {expanded} = this.state;

    const result = pnd.get(node);
    if (result == null) {
      throw new Error(
        `No decomposition result for ${NodeAddress.toString(node)}`
      );
    }
    const score = result.score;

    return [
      <tr key="self">
        <td style={{display: "flex", alignItems: "flex-start"}}>
          <button
            style={{
              marginRight: 5,
            }}
            onClick={() => {
              this.setState(({expanded}) => ({
                expanded: !expanded,
              }));
            }}
          >
            {expanded ? "\u2212" : "+"}
          </button>
          <span>{nodeDescription(node, adapters)}</span>
        </td>
        <td style={{textAlign: "right"}}>{"—"}</td>
        <td style={{textAlign: "right"}}>{scoreDisplay(score)}</td>
      </tr>,
      expanded && (
        <ContributionRowList
          key="children"
          depth={1}
          node={node}
          sharedProps={sharedProps}
        />
      ),
    ];
  }
}

type ContributionRowListProps = {|
  +depth: number,
  +node: NodeAddressT,
  +sharedProps: SharedProps,
|};

export class ContributionRowList extends React.PureComponent<
  ContributionRowListProps
> {
  render() {
    const {depth, node, sharedProps} = this.props;
    const {pnd, adapters, maxEntriesPerList} = sharedProps;
    const result = pnd.get(node);
    if (result == null) {
      throw new Error(
        `No decomposition result for ${NodeAddress.toString(node)}`
      );
    }
    const contributions = result.scoredContributions;

    return contributions
      .slice(0, maxEntriesPerList)
      .map((sc) => (
        <ContributionRow
          key={JSON.stringify(sc.contribution.contributor)}
          depth={depth}
          target={node}
          scoredContribution={sc}
          sharedProps={sharedProps}
        />
      ));
  }
}

type ContributionRowProps = {|
  +depth: number,
  +target: NodeAddressT,
  +scoredContribution: ScoredContribution,
  +sharedProps: SharedProps,
|};

export class ContributionRow extends React.PureComponent<
  ContributionRowProps,
  RowState
> {
  constructor() {
    super();
    this.state = {expanded: false};
  }
  render() {
    const {
      sharedProps,
      target,
      depth,
      scoredContribution: {
        contribution,
        source,
        sourceScore,
        contributionScore,
      },
    } = this.props;
    const {pnd, adapters} = sharedProps;
    const {expanded} = this.state;
    const targetResult = pnd.get(target);
    if (targetResult == null) {
      throw new Error(`No result for ${NodeAddress.toString(target)}`);
    }
    const contributionProportion = contributionScore / targetResult.score;
    const contributionPercent = (contributionProportion * 100).toFixed(2);

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
          <ContributionView
            target={target}
            contribution={contribution}
            adapters={adapters}
          />
        </td>
        <td style={{textAlign: "right"}}>{contributionPercent}%</td>
        <td style={{textAlign: "right"}}>{scoreDisplay(sourceScore)}</td>
      </tr>,
      expanded && (
        <ContributionRowList
          key="children"
          depth={depth + 1}
          node={source}
          sharedProps={sharedProps}
        />
      ),
    ];
  }
}

export class ContributionView extends React.PureComponent<{|
  +contribution: Contribution,
  +target: NodeAddressT,
  +adapters: $ReadOnlyArray<PluginAdapter>,
|}> {
  render() {
    const {contribution, target, adapters} = this.props;
    const source = contributorSource(target, contribution.contributor);
    function badge(text: string) {
      return (
        <span
          style={{
            display: "inline-block",
            textTransform: "uppercase",
            fontWeight: 700,
            fontSize: "smaller",
          }}
        >
          {text}
        </span>
      );
    }
    const {contributor} = contribution;
    switch (contributor.type) {
      case "SYNTHETIC_LOOP":
        return badge("synthetic loop");
      case "IN_EDGE":
        return (
          <span>
            {badge(edgeVerb(contributor.edge.address, "BACKWARD", adapters))}{" "}
            <span>{nodeDescription(contributor.edge.src, adapters)}</span>
          </span>
        );
      case "OUT_EDGE":
        return (
          <span>
            {badge(edgeVerb(contributor.edge.address, "FORWARD", adapters))}{" "}
            <span>{nodeDescription(contributor.edge.dst, adapters)}</span>
          </span>
        );
      default:
        throw new Error((contributor.type: empty));
    }
  }
}

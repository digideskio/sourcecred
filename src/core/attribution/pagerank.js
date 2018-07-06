// @flow

import {type Edge, Graph} from "../graph";
import {
  type PagerankResult,
  distributionToPagerankResult,
  createContributions,
  createOrderedSparseMarkovChain,
  type EdgeWeight,
  type NodeToContributions,
} from "./graphToMarkovChain";

import {findStationaryDistribution} from "./markovChain";

export type {PagerankResult} from "./graphToMarkovChain";
export type PagerankOptions = {|
  +selfLoopWeight?: number,
  +verbose?: boolean,
  +convergenceThreshold?: number,
  +maxIterations?: number,
|};

export type PagerankResultAndContributions = {|
  +pagerankResult: PagerankResult,
  +nodeToContributions: NodeToContributions,
|};

export type {EdgeWeight} from "./graphToMarkovChain";
export type EdgeEvaluator = (Edge) => EdgeWeight;

function defaultOptions(): PagerankOptions {
  return {
    verbose: false,
    selfLoopWeight: 1e-3,
    convergenceThreshold: 1e-7,
    maxIterations: 255,
  };
}

export function pagerank(
  graph: Graph,
  edgeWeight: EdgeEvaluator,
  options?: PagerankOptions
): PagerankResultAndContributions {
  const fullOptions = {
    ...defaultOptions(),
    ...(options || {}),
  };
  const contributions = createContributions(
    graph,
    edgeWeight,
    fullOptions.selfLoopWeight
  );
  const osmc = createOrderedSparseMarkovChain(contributions);
  const distribution = findStationaryDistribution(osmc.chain, {
    verbose: fullOptions.verbose,
    convergenceThreshold: fullOptions.convergenceThreshold,
    maxIterations: fullOptions.maxIterations,
  });
  const pagerankResult = distributionToPagerankResult(
    osmc.nodeOrder,
    distribution
  );
  return {pagerankResult, nodeToContributions: contributions};
}

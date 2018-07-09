// @flow

import {pagerank} from "./pagerank";
import {EdgeAddress, Graph, NodeAddress, edgeToStrings} from "../graph";
import {advancedGraph} from "../graphTestUtil";
import * as MapUtil from "../../util/map";

/**
 * Format a decomposition to be shown in a snapshot. This converts
 * addresses and edges to strings to avoid NUL characters.
 */
function formatDecomposition(d) {
  return MapUtil.mapEntries(d, (key, {score, scoredContributions}) => [
    NodeAddress.toString(key),
    {
      score,
      scoredContributions: scoredContributions.map(
        ({contribution, source, sourceScore, contributionScore}) => ({
          contribution: {
            contributor: formatContributor(contribution.contributor),
            weight: contribution.weight,
          },
          source: NodeAddress.toString(source),
          sourceScore,
          contributionScore,
        })
      ),
    },
  ]);
  function formatContributor(contributor) {
    switch (contributor.type) {
      case "SYNTHETIC_LOOP":
        return {type: "SYNTHETIC_LOOP"};
      case "IN_EDGE":
        return {type: "IN_EDGE", edge: edgeToStrings(contributor.edge)};
      case "OUT_EDGE":
        return {type: "OUT_EDGE", edge: edgeToStrings(contributor.edge)};
      default:
        throw new Error((contributor.type: empty));
    }
  }
}

function snapshotPagerankResult(result) {
  expect(formatDecomposition(result)).toMatchSnapshot();
}

describe("core/attribution/pagerank", () => {
  function edgeWeight(_unused_edge) {
    return {toWeight: 1, froWeight: 0};
  }
  it("snapshots as expected on the advanced graph", () => {
    const pagerankResult = pagerank(advancedGraph().graph1(), edgeWeight);
    snapshotPagerankResult(pagerankResult);
  });
  it("respects explicit arguments", () => {
    const pagerankResult = pagerank(advancedGraph().graph1(), edgeWeight, {
      maxIterations: 0,
    });
    snapshotPagerankResult(pagerankResult);
  });
});

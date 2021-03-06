// @flow

import stringify from "json-stable-stringify";
import deepEqual from "lodash.isequal";

import * as GN from "./nodes";
import * as GE from "./edges";

import {_Prefix as _GitPrefix} from "../git/nodes";

import {
  Graph,
  type NodeAddressT,
  Direction,
  type NeighborsOptions,
  NodeAddress,
  edgeToString,
} from "../../core/graph";

export class GraphView {
  _graph: Graph;
  _isCheckingInvariants: boolean;

  constructor(graph: Graph) {
    this._graph = graph;
    this._isCheckingInvariants = false;
    this._maybeCheckInvariants();
  }

  graph(): Graph {
    this._maybeCheckInvariants();
    return this._graph;
  }

  *_nodes<T: GN.StructuredAddress>(prefix: GN.RawAddress): Iterator<T> {
    for (const n of this._graph.nodes({prefix})) {
      const structured = GN.fromRaw((n: any));
      this._maybeCheckInvariants();
      yield (structured: any);
    }
    this._maybeCheckInvariants();
  }

  *_neighbors<T: GN.StructuredAddress>(
    node: GN.StructuredAddress,
    options: NeighborsOptions
  ): Iterator<T> {
    if (!NodeAddress.hasPrefix(options.nodePrefix, GN._Prefix.base)) {
      throw new Error(`_neighbors must filter to GitHub nodes`);
    }
    const rawNode = GN.toRaw(node);
    for (const neighbor of this._graph.neighbors(rawNode, options)) {
      this._maybeCheckInvariants();
      yield (GN.fromRaw((neighbor.node: any)): any);
    }
    this._maybeCheckInvariants();
  }

  _children<T: GN.StructuredAddress>(
    node: GN.StructuredAddress,
    nodePrefix: GN.RawAddress
  ): Iterator<T> {
    const options = {
      nodePrefix,
      edgePrefix: GE._Prefix.hasParent,
      direction: Direction.IN,
    };
    return this._neighbors(node, options);
  }

  repos(): Iterator<GN.RepoAddress> {
    return this._nodes(GN._Prefix.repo);
  }

  issues(repo: GN.RepoAddress): Iterator<GN.IssueAddress> {
    return this._children(repo, GN._Prefix.issue);
  }

  pulls(repo: GN.RepoAddress): Iterator<GN.PullAddress> {
    return this._children(repo, GN._Prefix.pull);
  }

  comments(commentable: GN.CommentableAddress): Iterator<GN.CommentAddress> {
    return this._children(commentable, GN._Prefix.comment);
  }

  reviews(pull: GN.PullAddress): Iterator<GN.ReviewAddress> {
    return this._children(pull, GN._Prefix.review);
  }

  // TODO(@wchrgin) figure out how to overload this fn signature
  parent(child: GN.ChildAddress): GN.ParentAddress {
    const options = {
      direction: Direction.OUT,
      edgePrefix: GE._Prefix.hasParent,
      nodePrefix: GN._Prefix.base,
    };
    const parents: GN.ParentAddress[] = Array.from(
      this._neighbors(child, options)
    );
    if (parents.length !== 1) {
      throw new Error(
        `Parent invariant violated for child: ${stringify(child)}`
      );
    }
    return parents[0];
  }

  authors(content: GN.AuthorableAddress): Iterator<GN.UserlikeAddress> {
    const options = {
      direction: Direction.IN,
      edgePrefix: GE._Prefix.authors,
      nodePrefix: GN._Prefix.userlike,
    };
    return this._neighbors(content, options);
  }

  _maybeCheckInvariants() {
    if (this._isCheckingInvariants) {
      return;
    }
    if (process.env.NODE_ENV === "test") {
      // TODO(perf): If this method becomes really slow, we can disable
      // it on specific tests wherein we construct large graphs.
      this.checkInvariants();
    }
  }

  checkInvariants() {
    this._isCheckingInvariants = true;
    try {
      this._checkInvariants();
    } finally {
      this._isCheckingInvariants = false;
    }
  }

  _checkInvariants() {
    const nodeTypeToParentAccessor = {
      [GN.REPO_TYPE]: null,
      [GN.ISSUE_TYPE]: (x) => x.repo,
      [GN.PULL_TYPE]: (x) => x.repo,
      [GN.COMMENT_TYPE]: (x) => x.parent,
      [GN.REVIEW_TYPE]: (x) => x.pull,
      [GN.USERLIKE_TYPE]: null,
    };
    for (const node of this._graph.nodes({prefix: GN._Prefix.base})) {
      const structuredNode = GN.fromRaw((node: any));
      const type = structuredNode.type;
      const parentAccessor = nodeTypeToParentAccessor[type];
      if (parentAccessor != null) {
        // this.parent will throw error if there is not exactly 1 parent
        const parent = this.parent((structuredNode: any));
        const expectedParent = parentAccessor((structuredNode: any));
        if (!deepEqual(parent, expectedParent)) {
          throw new Error(`${stringify(structuredNode)} has the wrong parent`);
        }
      }
    }

    type Hom = {|
      +srcPrefix: NodeAddressT,
      +dstPrefix: NodeAddressT,
    |};
    function homProduct(
      srcPrefixes: GN.RawAddress[],
      dstPrefixes: GN.RawAddress[]
    ): Hom[] {
      const result = [];
      for (const srcPrefix of srcPrefixes) {
        for (const dstPrefix of dstPrefixes) {
          result.push({srcPrefix, dstPrefix});
        }
      }
      return result;
    }
    type EdgeInvariant = {|
      +homs: Hom[],
      +srcAccessor?: (GE.StructuredAddress) => NodeAddressT,
      +dstAccessor?: (GE.StructuredAddress) => NodeAddressT,
    |};
    const edgeTypeToInvariants: {[type: string]: EdgeInvariant} = {
      [GE.HAS_PARENT_TYPE]: {
        homs: [
          {srcPrefix: GN._Prefix.issue, dstPrefix: GN._Prefix.repo},
          {srcPrefix: GN._Prefix.pull, dstPrefix: GN._Prefix.repo},
          {srcPrefix: GN._Prefix.review, dstPrefix: GN._Prefix.pull},
          {srcPrefix: GN._Prefix.reviewComment, dstPrefix: GN._Prefix.review},
          {srcPrefix: GN._Prefix.issueComment, dstPrefix: GN._Prefix.issue},
          {srcPrefix: GN._Prefix.pullComment, dstPrefix: GN._Prefix.pull},
        ],
        srcAccessor: (x) => GN.toRaw((x: any).child),
      },
      [GE.MERGED_AS_TYPE]: {
        homs: [
          {
            srcPrefix: GN._Prefix.pull,
            dstPrefix: _GitPrefix.commit,
          },
        ],
        srcAccessor: (x) => GN.toRaw((x: any).pull),
      },
      [GE.REFERENCES_TYPE]: {
        homs: homProduct(
          [
            GN._Prefix.issue,
            GN._Prefix.pull,
            GN._Prefix.review,
            GN._Prefix.comment,
          ],
          [
            GN._Prefix.repo,
            GN._Prefix.issue,
            GN._Prefix.pull,
            GN._Prefix.review,
            GN._Prefix.comment,
            GN._Prefix.userlike,
          ]
        ),
        srcAccessor: (x) => GN.toRaw((x: any).referrer),
        dstAccessor: (x) => GN.toRaw((x: any).referent),
      },
      [GE.AUTHORS_TYPE]: {
        homs: homProduct(
          [GN._Prefix.userlike],
          [
            GN._Prefix.issue,
            GN._Prefix.review,
            GN._Prefix.pull,
            GN._Prefix.comment,
          ]
        ),
        srcAccessor: (x) => GN.toRaw((x: any).author),
        dstAccessor: (x) => GN.toRaw((x: any).content),
      },
    };

    for (const edge of this._graph.edges({
      addressPrefix: GE._Prefix.base,
      srcPrefix: NodeAddress.empty,
      dstPrefix: NodeAddress.empty,
    })) {
      const address: GE.RawAddress = (edge.address: any);
      const structuredEdge = GE.fromRaw(address);
      const invariants = edgeTypeToInvariants[structuredEdge.type];
      if (invariants == null) {
        throw new Error(
          `Invariant: Unexpected edge type ${structuredEdge.type}`
        );
      }
      const {homs, srcAccessor, dstAccessor} = invariants;
      if (srcAccessor) {
        if (srcAccessor(structuredEdge) !== edge.src) {
          throw new Error(
            `Invariant: Expected src on edge ${edgeToString(
              edge
            )} to be ${srcAccessor(structuredEdge)}`
          );
        }
      }
      if (dstAccessor) {
        if (dstAccessor(structuredEdge) !== edge.dst) {
          throw new Error(
            `Invariant: Expected dst on edge ${edgeToString(
              edge
            )} to be ${dstAccessor(structuredEdge)}`
          );
        }
      }
      let foundHom = false;
      for (const {srcPrefix, dstPrefix} of homs) {
        if (
          NodeAddress.hasPrefix(edge.src, srcPrefix) &&
          NodeAddress.hasPrefix(edge.dst, dstPrefix)
        ) {
          foundHom = true;
          break;
        }
      }
      if (!foundHom) {
        throw new Error(
          `Invariant: Edge ${stringify(
            structuredEdge
          )} with edge ${edgeToString(
            edge
          )} did not satisfy src/dst prefix requirements`
        );
      }
    }
  }
}

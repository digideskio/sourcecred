// @flow

import {textBlocks} from "./parseMarkdown";

export type ParsedReference = {|
  // "@user" or "#123" or "https://github.com/owner/name/..."
  +ref: string,
  +refType: "BASIC" | "PAIRED_WITH",
|};

/**
 * Parse GitHub references from a Markdown document, such as an issue or
 * comment body. This will include references that span multiple lines
 * (across softbreaks), and exclude references that occur within code
 * blocks.
 */
export function parseReferences(body: string): ParsedReference[] {
  // Note to maintainer: If it becomes necessary to encode references in a
  // richer format, consider implementing the type signature described in
  // https://github.com/sourcecred/sourcecred/pull/130#pullrequestreview-113849998
  const blocks = textBlocks(body);
  return [].concat.apply([], blocks.map(parseReferencesFromRawString));
}

function parseReferencesFromRawString(textBlock: string): ParsedReference[] {
  return [
    ...findNumericReferences(textBlock),
    ...findRepoNumericReferences(textBlock),
    ...findGithubUrlReferences(textBlock),
    ...findUsernameReferences(textBlock),
  ];
}

function findRepoNumericReferences(textBlock: string): ParsedReference[] {
  return findAllMatches(
    /(?:\W|^)([a-zA-Z0-9-]+\/[a-zA-Z0-9-]+#\d+)(?=\W|$)/gm,
    textBlock
  ).map((x) => ({
    refType: "BASIC",
    ref: x[1],
  }));
}

function findNumericReferences(textBlock: string): ParsedReference[] {
  return findAllMatches(/(?:\W|^)(#\d+)(?=\W|$)/gm, textBlock).map((x) => ({
    refType: "BASIC",
    ref: x[1],
  }));
}

function findUsernameReferences(textBlock: string): ParsedReference[] {
  const pairedWithRefs = findAllMatches(
    /(?:\W|^)(?:P|p)aired(?:-| )(?:w|W)ith:? (@[a-zA-Z0-9-]+)(?=\W|$)/gm,
    textBlock
  ).map((x) => ({ref: x[1], refType: "PAIRED_WITH"}));
  const basicRefs = findAllMatches(
    /(?:\W|^)(@[a-zA-Z0-9-]+)(?=\W|$)/gm,
    textBlock
  ).map((x) => ({ref: x[1], refType: "BASIC"}));
  for (const {ref} of pairedWithRefs) {
    const basicRefIndexToRemove = basicRefs.findIndex((x) => x.ref === ref);
    if (basicRefIndexToRemove === -1) {
      throw new Error(`Couldn't find BASIC ref for paired with ref: ${ref}`);
    }
    basicRefs.splice(basicRefIndexToRemove, 1);
  }
  return [...pairedWithRefs, ...basicRefs];
}

function findGithubUrlReferences(textBlock: string): ParsedReference[] {
  const githubNamePart = /(?:[a-zA-Z0-9_-]+)/.source;
  const urlRegex = new RegExp(
    "" +
      /(?:\W|^)/.source +
      "(" +
      /http(?:s)?:\/\/github.com\//.source +
      githubNamePart +
      "(?:" +
      /\//.source +
      githubNamePart +
      /\/(?:issues|pull)\//.source +
      /(?:\d+)/.source +
      /(?:#(?:issue|issuecomment|pullrequestreview|discussion_r)-?(?:\d+))?/
        .source +
      ")?" +
      ")" +
      /(?=[^\w/]|$)/.source,
    "gm"
  );
  return findAllMatches(urlRegex, textBlock).map((match) => ({
    refType: "BASIC",
    ref: match[1],
  }));
}

function findAllMatches(re: RegExp, s: string): any[] {
  // modified from: https://stackoverflow.com/a/6323598
  let m;
  const matches = [];
  do {
    m = re.exec(s);
    if (m) {
      matches.push(m);
    }
  } while (m);
  return matches;
}

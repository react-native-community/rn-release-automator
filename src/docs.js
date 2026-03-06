// @flow

// Documentation references for each command

const DOCS_BASE: string =
  "https://github.com/reactwg/react-native-releases/blob/main/docs";

export const DOCS: {[string]: string} = {
  cutBranch: `${DOCS_BASE}/guide-release-candidate.md`,
  createGithubProject: `${DOCS_BASE}/guide-release-project-setup.md`,
  prepareRelease: `${DOCS_BASE}/guide-release-process.md`,
  publish: `${DOCS_BASE}/guide-release-process.md`,
  hermes: `${DOCS_BASE}/guide-hermes-release.md`,
  testRelease: `${DOCS_BASE}/guide-release-testing.md`,
  verifyRelease: `${DOCS_BASE}/guide-release-process.md`,
  postPromotion: `${DOCS_BASE}/guide-release-process.md`,
  communicate: `${DOCS_BASE}/guide-release-process.md`,
  support: `${DOCS_BASE}/support.md`,
};

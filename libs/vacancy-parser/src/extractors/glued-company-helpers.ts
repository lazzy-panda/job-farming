const RAW_TOKENS = [
  'TypeScript',
  'Typescript',
  'Type Script',
  'JavaScript',
  'Javascript',
  'Java Script',
  'DevOps',
  'Dev Ops',
  'NestJS',
  'Nest JS',
  'NodeJS',
  'Node JS',
  'React',
  'Angular',
  'Vue',
  'Svelte',
  'NextJS',
  'NuxtJS',
  'Golang',
  'Go Lang',
  'Python',
  'Java',
  'Kotlin',
  'Swift',
  'Objective C',
  'iOS',
  'Android',
  'Flutter',
  'React Native',
  'Docker',
  'Kubernetes',
  'K8S',
  'AWS',
  'Azure',
  'GCP',
  'SQL',
  'NoSQL',
  'Data Science',
  'Machine Learning',
  'AI',
  'ML',
  'Linux',
  'Engineer',
  'Developer',
  'Manager',
  'Lead',
  'Architect',
  'Administrator',
  'Analyst',
  'Designer',
  'Product Manager',
  'Project Manager',
  'Scrum Master',
  'Recruiter',
  'HR',
  'Backend',
  'Front End',
  'Frontend',
  'Fullstack',
  'Full Stack',
  'Ops',
  'OTE',
  'JS',
  'TS',
  'QA',
  'HR',
  'PM',
  'PO',
  'UX',
  'UI',
  'BI',
  'AI',
  'ML',
  'SaaS',
  'DevSecOps',
  'Cloud',
  'Backend',
  'Frontend',
  'Fullstack',
];

const NORMALIZED_BLOCKLIST = new Set(
  RAW_TOKENS.map((token) => normalizeToken(token)).filter((token) => token.length > 0),
);

function normalizeToken(token: string): string {
  return token.replace(/[\s._\-+]/g, '').toLowerCase();
}

export function shouldSkipGluedToken(candidate: string): boolean {
  const normalized = normalizeToken(candidate.trim());
  if (!normalized) {
    return true;
  }
  if (normalized.length <= 2 && !/^[a-z0-9]{2}$/.test(normalized)) {
    return true;
  }
  return NORMALIZED_BLOCKLIST.has(normalized);
}

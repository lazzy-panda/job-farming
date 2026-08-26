import type { DocumentContext } from '../core/document-context';
import type { LocationInfo, ParsedLocation, RuleTrace } from '../model/types';

export interface LocationExtractResult {
  location: ParsedLocation;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type Hit = {
  city: string | null;
  country: string | null;
  relocation: boolean;
  visaSupport: boolean;
  section: string;
  snippet: string;
  score: number;
  ruleId: string;
};

const NON_LOCATION_TOKENS = new Set<string>([
  'django',
  'fastapi',
  'node.js',
  'nodejs',
  'nestjs',
  'react',
  'angular',
  'vue',
  'postgresql',
  'mysql',
  'kafka',
  'docker',
  'kubernetes',
  'gitlab',
  'github',
  'prometheus',
  'grafana',
  'sentry',
  'java',
  'oop',
  // url/email noise
  'http',
  'https',
  'www',
  't',
  'me',
  'com',
  'net',
  'org',
  'io',
  'ai',
  'app',
  'dev',
] as const);

const BANNED_LOCATION_WORDS = new Set<string>([
  'year',
  'years',
  'working',
  'hours',
  'working hours',
  'experience',
  'benefits',
  'requirements',
  'responsibilities',
  'compensation',
  'salary',
  'offer',
  'retirement',
  'pto',
  'bonus',
  'ote',
  'k',
] as const);

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  DE: 'Germany',
  AT: 'Austria',
  CH: 'Switzerland',
  FR: 'France',
  ES: 'Spain',
  IT: 'Italy',
  PT: 'Portugal',
  NL: 'Netherlands',
  BE: 'Belgium',
  LU: 'Luxembourg',
  IE: 'Ireland',
  GB: 'UK',
  UK: 'UK',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  IS: 'Iceland',
  PL: 'Poland',
  CZ: 'Czechia',
  SK: 'Slovakia',
  SI: 'Slovenia',
  HR: 'Croatia',
  RO: 'Romania',
  BG: 'Bulgaria',
  HU: 'Hungary',
  LT: 'Lithuania',
  LV: 'Latvia',
  EE: 'Estonia',
  CY: 'Cyprus',
  GR: 'Greece',
  UA: 'Ukraine',
  BY: 'Belarus',
  KZ: 'Kazakhstan',
  GE: 'Georgia',
  AM: 'Armenia',
  AZ: 'Azerbaijan',
  TR: 'Turkey',
  RU: 'Russia',
  US: 'USA',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  SG: 'Singapore',
  TH: 'Thailand',
  VN: 'Vietnam',
  PH: 'Philippines',
  ID: 'Indonesia',
  MY: 'Malaysia',
  CN: 'China',
  JP: 'Japan',
  KR: 'South Korea',
  IN: 'India',
  IL: 'Israel',
  AE: 'UAE',
};

function countryFromDefault(code: string | null): string | null {
  if (!code) {
    return null;
  }
  return COUNTRY_CODE_TO_NAME[code.trim().toUpperCase()] ?? null;
}

function isCamelLike(value: string): boolean {
  return /[a-z][A-Z]/.test(value);
}

function isAllLowerAsciiWords(value: string): boolean {
  const v = value.trim();
  return /^[a-z][a-z\s-]+$/.test(v);
}

const COUNTRY_ALIASES: Array<{ re: RegExp; country: string }> = [
  { re: /\b(russia|rf|ru)\b/i, country: 'Russia' },
  // NOTE: do not rely on \b for Cyrillic (JS word boundary is ASCII-ish)
  // IMPORTANT: keep "рф" as a standalone token (avoid matching inside words like "интерфейс")
  { re: /(?:^|[^А-Яа-яЁё])(?:россия|рф)(?:$|[^А-Яа-яЁё])/i, country: 'Russia' },
  { re: /\b(usa|us|united\s+states)\b/i, country: 'USA' },
  { re: /\b(uk|united\s+kingdom|great\s+britain|gb)\b/i, country: 'UK' },
  { re: /\b(ireland|ie)\b/i, country: 'Ireland' },
  { re: /\b(portugal|pt)\b/i, country: 'Portugal' },
  { re: /\b(belgium|be)\b/i, country: 'Belgium' },
  { re: /\b(austria|at)\b/i, country: 'Austria' },
  { re: /\b(czechia|czech\s+republic|cz)\b/i, country: 'Czechia' },
  { re: /\b(hungary|hu)\b/i, country: 'Hungary' },
  { re: /\b(romania|ro)\b/i, country: 'Romania' },
  { re: /\b(bulgaria|bg)\b/i, country: 'Bulgaria' },
  { re: /\b(finland|fi)\b/i, country: 'Finland' },
  { re: /\b(estonia|ee)\b/i, country: 'Estonia' },
  { re: /\b(latvia|lv)\b/i, country: 'Latvia' },
  { re: /\b(lithuania|lt)\b/i, country: 'Lithuania' },
  { re: /\b(croatia|hr)\b/i, country: 'Croatia' },
  { re: /\b(slovenia|si)\b/i, country: 'Slovenia' },
  { re: /\b(slovakia|sk)\b/i, country: 'Slovakia' },
  { re: /\b(luxembourg|lu)\b/i, country: 'Luxembourg' },
  { re: /\biceland\b/i, country: 'Iceland' },
  // "is" как код страны только если стоит отдельно и не является частью слова
  { re: /(?:^|[^a-z])\bis\b(?:[^a-z]|$)/i, country: 'Iceland' },
  { re: /\b(greece|hellas|ellada|ελλάδα|hellenic)\b/i, country: 'Greece' },
  { re: /\b(cyprus|κύπρος)\b/i, country: 'Cyprus' },
  // Cyrillic alias (do not rely on \b for Cyrillic)
  { re: /кипр/iu, country: 'Cyprus' },
  { re: /\b(switzerland|schweiz|suisse)\b/i, country: 'Switzerland' },
  { re: /\b(sweden|sverige)\b/i, country: 'Sweden' },
  { re: /\b(norway|norge)\b/i, country: 'Norway' },
  { re: /\b(denmark|danmark)\b/i, country: 'Denmark' },
  { re: /\b(france)\b/i, country: 'France' },
  { re: /\b(netherlands|holland)\b/i, country: 'Netherlands' },
  { re: /\b(spain|españa)\b/i, country: 'Spain' },
  { re: /\b(italy|italia)\b/i, country: 'Italy' },
  { re: /\b(germany|deutschland)\b/i, country: 'Germany' },
  { re: /\b(pol\w*|poland)\b/i, country: 'Poland' },
  { re: /\b(georgia)\b/i, country: 'Georgia' },
  { re: /\b(armenia)\b/i, country: 'Armenia' },
  { re: /\b(serbia)\b/i, country: 'Serbia' },
  { re: /\b(uae|united\s+arab\s+emirates)\b/i, country: 'UAE' },
  { re: /\b(kazakhstan)\b|\bказахстан\b/i, country: 'Kazakhstan' },
  { re: /\b(ukraine)\b|\bукраина\b/i, country: 'Ukraine' },
  { re: /\b(israel|il)\b/i, country: 'Israel' },
  { re: /\b(china|prc|people's\s+republic\s+of\s+china)\b/i, country: 'China' },
  { re: /\b(japan|jp)\b/i, country: 'Japan' },
  { re: /\b(south\s+korea|korea|republic\s+of\s+korea|rok)\b/i, country: 'South Korea' },
  { re: /\b(india|in)\b/i, country: 'India' },
  { re: /\b(singapore|sg)\b/i, country: 'Singapore' },
  { re: /\b(thailand|th)\b/i, country: 'Thailand' },
  { re: /\b(vietnam|vn)\b/i, country: 'Vietnam' },
  { re: /\b(philippines|ph)\b/i, country: 'Philippines' },
  { re: /\b(indonesia|id)\b/i, country: 'Indonesia' },
  { re: /\b(malaysia|my)\b/i, country: 'Malaysia' },
  { re: /\b(taiwan|tw)\b/i, country: 'Taiwan' },
  { re: /\b(hong\s+kong|hk)\b/i, country: 'Hong Kong' },
  { re: /\b(saudi\s+arabia|sa)\b/i, country: 'Saudi Arabia' },
  { re: /\bqatar\b/i, country: 'Qatar' },
  { re: /\b(kuwait|kw)\b/i, country: 'Kuwait' },
  { re: /\b(bahrain|bh)\b/i, country: 'Bahrain' },
  { re: /\b(oman|om)\b/i, country: 'Oman' },
  { re: /\b(turkey|tr|türkiye)\b/i, country: 'Turkey' },
];

function isKnownCountryToken(value: string): boolean {
  const v = value.trim();
  if (!v) {
    return false;
  }
  if (/^[A-Z]{2,3}$/.test(v)) {
    return true;
  }
  for (const a of COUNTRY_ALIASES) {
    if (a.re.test(v)) {
      return true;
    }
  }
  return false;
}

const CITY_ALIASES: Array<{ re: RegExp; city: string; country?: string }> = [
  // NOTE: do not rely on \b for Cyrillic (JS word boundary is ASCII-ish)
  { re: /(\bmoscow\b|москва)/i, city: 'Moscow', country: 'Russia' },
  { re: /(\bsaint\s*petersburg\b|\bspb\b|санкт-?петербург|питер)/i, city: 'Saint Petersburg', country: 'Russia' },
  { re: /(\bnovosibirsk\b|новосибирск)/i, city: 'Novosibirsk', country: 'Russia' },
  { re: /(\bminsk\b|минск)/i, city: 'Minsk' },
  { re: /(\btbilisi\b|тбилиси)/i, city: 'Tbilisi', country: 'Georgia' },
  { re: /(\byerevan\b|ереван)/i, city: 'Yerevan', country: 'Armenia' },
  { re: /(\bbatumi\b|батуми)/i, city: 'Batumi', country: 'Georgia' },
  { re: /(\bwarsaw\b|варшава)/i, city: 'Warsaw', country: 'Poland' },
  { re: /(\bberlin\b|берлин)/i, city: 'Berlin', country: 'Germany' },
  { re: /(\blondon\b|лондон)/i, city: 'London', country: 'UK' },
  { re: /\bamsterdam\b/i, city: 'Amsterdam', country: 'Netherlands' },
  { re: /\bparis\b/i, city: 'Paris', country: 'France' },
  { re: /\bmadrid\b/i, city: 'Madrid', country: 'Spain' },
  { re: /\bbarcelona\b/i, city: 'Barcelona', country: 'Spain' },
  { re: /\brome\b|\broma\b/i, city: 'Rome', country: 'Italy' },
  { re: /\bmilan\b|\bmilano\b/i, city: 'Milan', country: 'Italy' },
  { re: /\bdublin\b/i, city: 'Dublin', country: 'Ireland' },
  { re: /\blisbon\b|\blisboa\b/i, city: 'Lisbon', country: 'Portugal' },
  { re: /\bporto\b/i, city: 'Porto', country: 'Portugal' },
  { re: /\bvienna\b|\bwien\b/i, city: 'Vienna', country: 'Austria' },
  { re: /\bprague\b|\bpraha\b/i, city: 'Prague', country: 'Czechia' },
  { re: /\bbrno\b/i, city: 'Brno', country: 'Czechia' },
  { re: /\bbudapest\b/i, city: 'Budapest', country: 'Hungary' },
  { re: /\bbucharest\b|\bbucurești\b/i, city: 'Bucharest', country: 'Romania' },
  { re: /\bsofia\b/i, city: 'Sofia', country: 'Bulgaria' },
  { re: /\bhelsinki\b/i, city: 'Helsinki', country: 'Finland' },
  { re: /\btallinn\b/i, city: 'Tallinn', country: 'Estonia' },
  { re: /\briga\b/i, city: 'Riga', country: 'Latvia' },
  { re: /\bvilnius\b/i, city: 'Vilnius', country: 'Lithuania' },
  { re: /\bzagreb\b/i, city: 'Zagreb', country: 'Croatia' },
  { re: /\bljubljana\b/i, city: 'Ljubljana', country: 'Slovenia' },
  { re: /\bbratislava\b/i, city: 'Bratislava', country: 'Slovakia' },
  { re: /\bluxembourg\b/i, city: 'Luxembourg', country: 'Luxembourg' },
  { re: /\breykjav[ií]k\b/i, city: 'Reykjavik', country: 'Iceland' },
  // Serbia
  { re: /(\bbelgrade\b|белград)/i, city: 'Belgrade', country: 'Serbia' },
  { re: /\bnovi\s+sad\b/i, city: 'Novi Sad', country: 'Serbia' },
  // Kazakhstan
  { re: /(\balmaty\b|алматы)/i, city: 'Almaty', country: 'Kazakhstan' },
  // Greece
  { re: /\bathens\b|αθήνα/i, city: 'Athens', country: 'Greece' },
  { re: /\bthessaloniki\b|θεσσαλονίκη/i, city: 'Thessaloniki', country: 'Greece' },
  // Cyprus
  { re: /\bnicosia\b|lefkosia|λευκωσία/i, city: 'Nicosia', country: 'Cyprus' },
  { re: /\blimassol\b|λεμεσός/i, city: 'Limassol', country: 'Cyprus' },
  { re: /\blarnaca\b|λά[ρr]νακα/i, city: 'Larnaca', country: 'Cyprus' },
  // UK - крупные города
  { re: /\bmanchester\b/i, city: 'Manchester', country: 'UK' },
  { re: /\bbirmingham\b/i, city: 'Birmingham', country: 'UK' },
  { re: /\bliverpool\b/i, city: 'Liverpool', country: 'UK' },
  { re: /\bedinburgh\b/i, city: 'Edinburgh', country: 'UK' },
  { re: /\bglasgow\b/i, city: 'Glasgow', country: 'UK' },
  { re: /\bleeds\b/i, city: 'Leeds', country: 'UK' },
  { re: /\bbristol\b/i, city: 'Bristol', country: 'UK' },
  // Germany - крупные города
  { re: /\bmunich\b|\bmünchen\b/i, city: 'Munich', country: 'Germany' },
  { re: /\bhamburg\b/i, city: 'Hamburg', country: 'Germany' },
  { re: /\bfrankfurt\b/i, city: 'Frankfurt', country: 'Germany' },
  { re: /\bcologne\b|\bköln\b/i, city: 'Cologne', country: 'Germany' },
  { re: /\bstuttgart\b/i, city: 'Stuttgart', country: 'Germany' },
  { re: /\bdüsseldorf\b/i, city: 'Düsseldorf', country: 'Germany' },
  { re: /\bdortmund\b/i, city: 'Dortmund', country: 'Germany' },
  { re: /\bessen\b/i, city: 'Essen', country: 'Germany' },
  // France - крупные города
  { re: /\blyon\b/i, city: 'Lyon', country: 'France' },
  { re: /\bmarseille\b/i, city: 'Marseille', country: 'France' },
  { re: /\btoulouse\b/i, city: 'Toulouse', country: 'France' },
  { re: /\bnice\b(?!\s+to\s+have)/i, city: 'Nice', country: 'France' },
  { re: /\bnantes\b/i, city: 'Nantes', country: 'France' },
  { re: /\bstrasbourg\b/i, city: 'Strasbourg', country: 'France' },
  { re: /\bmontpellier\b/i, city: 'Montpellier', country: 'France' },
  // Italy - крупные города
  { re: /\bnaples\b|\bnapoli\b/i, city: 'Naples', country: 'Italy' },
  { re: /\bturin\b|\btorino\b/i, city: 'Turin', country: 'Italy' },
  { re: /\bpalermo\b/i, city: 'Palermo', country: 'Italy' },
  { re: /\bgenoa\b|\bgenova\b/i, city: 'Genoa', country: 'Italy' },
  { re: /\bbologna\b/i, city: 'Bologna', country: 'Italy' },
  { re: /\bflorence\b|\bfirenze\b/i, city: 'Florence', country: 'Italy' },
  { re: /\bbari\b/i, city: 'Bari', country: 'Italy' },
  // Spain - крупные города
  { re: /\bvalencia\b/i, city: 'Valencia', country: 'Spain' },
  { re: /\bseville\b|\bsevilla\b/i, city: 'Seville', country: 'Spain' },
  { re: /\bzaragoza\b/i, city: 'Zaragoza', country: 'Spain' },
  { re: /\bmálaga\b|\bmalaga\b/i, city: 'Málaga', country: 'Spain' },
  { re: /\bmurcia\b/i, city: 'Murcia', country: 'Spain' },
  { re: /\bbilbao\b/i, city: 'Bilbao', country: 'Spain' },
  // Netherlands - крупные города
  { re: /\brotterdam\b/i, city: 'Rotterdam', country: 'Netherlands' },
  { re: /\bthe\s+hague\b|\bden\s+haag\b/i, city: 'The Hague', country: 'Netherlands' },
  { re: /\butrecht\b/i, city: 'Utrecht', country: 'Netherlands' },
  { re: /\beindhoven\b/i, city: 'Eindhoven', country: 'Netherlands' },
  // Belgium - крупные города
  { re: /\bantwerp\b|\bantwerpen\b/i, city: 'Antwerp', country: 'Belgium' },
  { re: /\bgent\b|\bghent\b/i, city: 'Ghent', country: 'Belgium' },
  { re: /\bbruges\b|\bbrugge\b/i, city: 'Bruges', country: 'Belgium' },
  // Switzerland - крупные города
  { re: /\bzurich\b|\bzürich\b/i, city: 'Zurich', country: 'Switzerland' },
  { re: /\bgeneva\b|\bgenève\b/i, city: 'Geneva', country: 'Switzerland' },
  { re: /\bbasel\b/i, city: 'Basel', country: 'Switzerland' },
  { re: /\bbern\b|\bberne\b/i, city: 'Bern', country: 'Switzerland' },
  { re: /\blausanne\b/i, city: 'Lausanne', country: 'Switzerland' },
  // Austria - крупные города
  { re: /\bgraz\b/i, city: 'Graz', country: 'Austria' },
  { re: /\blinz\b/i, city: 'Linz', country: 'Austria' },
  { re: /\bsalzburg\b/i, city: 'Salzburg', country: 'Austria' },
  // Poland - крупные города
  { re: /\bkrakow\b|\bkraków\b/i, city: 'Krakow', country: 'Poland' },
  { re: /\bwroclaw\b|\bwrocław\b/i, city: 'Wroclaw', country: 'Poland' },
  { re: /\bpoznan\b|\bpoznań\b/i, city: 'Poznan', country: 'Poland' },
  { re: /\bgdansk\b|\bgdańsk\b/i, city: 'Gdansk', country: 'Poland' },
  // Czechia - крупные города
  { re: /\bostrava\b/i, city: 'Ostrava', country: 'Czechia' },
  // Hungary - крупные города
  { re: /\bdebrecen\b/i, city: 'Debrecen', country: 'Hungary' },
  { re: /\bszeged\b/i, city: 'Szeged', country: 'Hungary' },
  // Romania - крупные города
  { re: /\bcluj\b|\bcluj-napoca\b/i, city: 'Cluj-Napoca', country: 'Romania' },
  { re: /\btimișoara\b|\btimisoara\b/i, city: 'Timișoara', country: 'Romania' },
  { re: /\biași\b|\biasi\b/i, city: 'Iași', country: 'Romania' },
  // Bulgaria - крупные города
  { re: /\bplovdiv\b/i, city: 'Plovdiv', country: 'Bulgaria' },
  { re: /\bvarna\b/i, city: 'Varna', country: 'Bulgaria' },
  // Croatia - крупные города
  { re: /\bsplit\b/i, city: 'Split', country: 'Croatia' },
  // Norway - крупные города
  { re: /\bbergen\b/i, city: 'Bergen', country: 'Norway' },
  { re: /\btrondheim\b/i, city: 'Trondheim', country: 'Norway' },
  // Sweden - крупные города
  { re: /\bgothenburg\b|\bgöteborg\b/i, city: 'Gothenburg', country: 'Sweden' },
  { re: /\bmalmö\b|\bmalmo\b/i, city: 'Malmö', country: 'Sweden' },
  // Denmark - крупные города
  { re: /\baarhus\b/i, city: 'Aarhus', country: 'Denmark' },
  // Finland - крупные города
  { re: /\btampere\b/i, city: 'Tampere', country: 'Finland' },
  { re: /\bturku\b/i, city: 'Turku', country: 'Finland' },
  // Ireland - крупные города
  { re: /\bcork\b/i, city: 'Cork', country: 'Ireland' },
  // Israel - крупные города
  { re: /\btel\s+aviv\b|\btel\s+aviv[-\s]?yafo\b/i, city: 'Tel Aviv', country: 'Israel' },
  { re: /\bjerusalem\b/i, city: 'Jerusalem', country: 'Israel' },
  { re: /\bhaifa\b/i, city: 'Haifa', country: 'Israel' },
  { re: /\brishon\s+lezion\b|\brishon\s+le[-\s]?zion\b/i, city: 'Rishon LeZion', country: 'Israel' },
  { re: /\bpetah\s+tikva\b/i, city: 'Petah Tikva', country: 'Israel' },
  { re: /\bashdod\b/i, city: 'Ashdod', country: 'Israel' },
  { re: /\bnetanya\b/i, city: 'Netanya', country: 'Israel' },
  { re: /\bbeer\s+sheva\b|\bbeersheba\b/i, city: 'Beer Sheva', country: 'Israel' },
  // UAE - крупные города
  { re: /\bdubai\b/i, city: 'Dubai', country: 'UAE' },
  { re: /\babu\s+dhabi\b/i, city: 'Abu Dhabi', country: 'UAE' },
  { re: /\bsharjah\b/i, city: 'Sharjah', country: 'UAE' },
  { re: /\bajman\b/i, city: 'Ajman', country: 'UAE' },
  { re: /\bra's\s+al[-\s]?khaimah\b/i, city: 'Ras Al Khaimah', country: 'UAE' },
  { re: /\bfujairah\b/i, city: 'Fujairah', country: 'UAE' },
  { re: /\bumm\s+al[-\s]?quwain\b/i, city: 'Umm Al Quwain', country: 'UAE' },
  // China - крупные города
  { re: /\bbeijing\b|\bpeking\b/i, city: 'Beijing', country: 'China' },
  { re: /\bshanghai\b/i, city: 'Shanghai', country: 'China' },
  { re: /\bguangzhou\b/i, city: 'Guangzhou', country: 'China' },
  { re: /\bshenzhen\b/i, city: 'Shenzhen', country: 'China' },
  { re: /\bchengdu\b/i, city: 'Chengdu', country: 'China' },
  { re: /\bhangzhou\b/i, city: 'Hangzhou', country: 'China' },
  { re: /\bwuhan\b/i, city: 'Wuhan', country: 'China' },
  { re: /\bxi'an\b|\bxian\b/i, city: 'Xi\'an', country: 'China' },
  { re: /\bnanjing\b/i, city: 'Nanjing', country: 'China' },
  { re: /\btianjin\b/i, city: 'Tianjin', country: 'China' },
  // Japan - крупные города
  { re: /\btokyo\b/i, city: 'Tokyo', country: 'Japan' },
  { re: /\byokohama\b/i, city: 'Yokohama', country: 'Japan' },
  { re: /\bosaka\b/i, city: 'Osaka', country: 'Japan' },
  { re: /\bnagoya\b/i, city: 'Nagoya', country: 'Japan' },
  { re: /\bsapporo\b/i, city: 'Sapporo', country: 'Japan' },
  { re: /\bfukuoka\b/i, city: 'Fukuoka', country: 'Japan' },
  { re: /\bkyoto\b/i, city: 'Kyoto', country: 'Japan' },
  { re: /\bkobe\b/i, city: 'Kobe', country: 'Japan' },
  // South Korea - крупные города
  { re: /\bseoul\b/i, city: 'Seoul', country: 'South Korea' },
  { re: /\bbusan\b/i, city: 'Busan', country: 'South Korea' },
  { re: /\bincheon\b/i, city: 'Incheon', country: 'South Korea' },
  { re: /\bdaegu\b/i, city: 'Daegu', country: 'South Korea' },
  { re: /\bdaejeon\b/i, city: 'Daejeon', country: 'South Korea' },
  { re: /\bgwangju\b/i, city: 'Gwangju', country: 'South Korea' },
  // India - крупные города
  { re: /\bmumbai\b|\bbombay\b/i, city: 'Mumbai', country: 'India' },
  { re: /\bdelhi\b|\bnew\s+delhi\b/i, city: 'Delhi', country: 'India' },
  { re: /\bbangalore\b|\bbengaluru\b/i, city: 'Bangalore', country: 'India' },
  { re: /\bhyderabad\b/i, city: 'Hyderabad', country: 'India' },
  { re: /\bchennai\b|\bmadras\b/i, city: 'Chennai', country: 'India' },
  { re: /\bkolkata\b|\bcalcutta\b/i, city: 'Kolkata', country: 'India' },
  { re: /\bpune\b/i, city: 'Pune', country: 'India' },
  { re: /\bjaipur\b/i, city: 'Jaipur', country: 'India' },
  { re: /\bsurat\b/i, city: 'Surat', country: 'India' },
  { re: /\blucknow\b/i, city: 'Lucknow', country: 'India' },
  // Singapore
  { re: /\bsingapore\b/i, city: 'Singapore', country: 'Singapore' },
  // Thailand - крупные города
  { re: /\bbangkok\b/i, city: 'Bangkok', country: 'Thailand' },
  { re: /\bchiang\s+mai\b/i, city: 'Chiang Mai', country: 'Thailand' },
  { re: /\bphuket\b/i, city: 'Phuket', country: 'Thailand' },
  // Vietnam - крупные города
  { re: /\bho\s+chi\s+minh\s+city\b|\bsaigon\b/i, city: 'Ho Chi Minh City', country: 'Vietnam' },
  { re: /\bhanoi\b/i, city: 'Hanoi', country: 'Vietnam' },
  { re: /\bda\s+nang\b/i, city: 'Da Nang', country: 'Vietnam' },
  // Philippines - крупные города
  { re: /\bmanila\b/i, city: 'Manila', country: 'Philippines' },
  { re: /\bcebu\b/i, city: 'Cebu', country: 'Philippines' },
  { re: /\bdavao\b/i, city: 'Davao', country: 'Philippines' },
  // Indonesia - крупные города
  { re: /\bjakarta\b/i, city: 'Jakarta', country: 'Indonesia' },
  { re: /\bsurabaya\b/i, city: 'Surabaya', country: 'Indonesia' },
  { re: /\bbandung\b/i, city: 'Bandung', country: 'Indonesia' },
  { re: /\bmedan\b/i, city: 'Medan', country: 'Indonesia' },
  // Malaysia - крупные города
  { re: /\bkuala\s+lumpur\b/i, city: 'Kuala Lumpur', country: 'Malaysia' },
  { re: /\bpenang\b|\bgeorge\s+town\b/i, city: 'Penang', country: 'Malaysia' },
  { re: /\bjohor\s+bahru\b/i, city: 'Johor Bahru', country: 'Malaysia' },
  // Taiwan
  { re: /\btaipei\b/i, city: 'Taipei', country: 'Taiwan' },
  { re: /\bkaohsiung\b/i, city: 'Kaohsiung', country: 'Taiwan' },
  { re: /\btaichung\b/i, city: 'Taichung', country: 'Taiwan' },
  // Hong Kong
  { re: /\bhong\s+kong\b/i, city: 'Hong Kong', country: 'Hong Kong' },
  // Saudi Arabia - крупные города
  { re: /\briyadh\b|\briyad\b/i, city: 'Riyadh', country: 'Saudi Arabia' },
  { re: /\bjeddah\b/i, city: 'Jeddah', country: 'Saudi Arabia' },
  { re: /\bdammam\b/i, city: 'Dammam', country: 'Saudi Arabia' },
  { re: /\bmecca\b|\bmakkah\b/i, city: 'Mecca', country: 'Saudi Arabia' },
  { re: /\bmedina\b|\bmadinah\b/i, city: 'Medina', country: 'Saudi Arabia' },
  // Qatar
  { re: /\bdoha\b/i, city: 'Doha', country: 'Qatar' },
  // Kuwait
  { re: /\bkuwait\s+city\b/i, city: 'Kuwait City', country: 'Kuwait' },
  // Bahrain
  { re: /\bmanama\b/i, city: 'Manama', country: 'Bahrain' },
  // Oman
  { re: /\bmuscat\b/i, city: 'Muscat', country: 'Oman' },
  // Turkey - крупные города
  { re: /\bistanbul\b/i, city: 'Istanbul', country: 'Turkey' },
  { re: /\bankara\b/i, city: 'Ankara', country: 'Turkey' },
  { re: /\bizmir\b/i, city: 'Izmir', country: 'Turkey' },
  { re: /\bantalya\b/i, city: 'Antalya', country: 'Turkey' },
  { re: /\bbursa\b/i, city: 'Bursa', country: 'Turkey' },
  // US common aliases (minimal, for better normalization)
  { re: /\bnyc\b|\bnew\s+york\s+city\b/i, city: 'New York', country: 'USA' },
  { re: /\bnew\s+york\b/i, city: 'New York', country: 'USA' },
  { re: /\bsf\b|\bsan\s+francisco\b/i, city: 'San Francisco', country: 'USA' },
];

const US_STATE_CODES = new Set<string>([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
] as const);

function sectionWeight(sectionName: string): number {
  if (sectionName === 'head') {
    return 3;
  }
  if (sectionName === 'benefits') {
    return 2;
  }
  if (sectionName === 'body') {
    return 1;
  }
  return 1;
}

function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + len + 50);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function detectRelocation(text: string): boolean {
  const v = text.toLowerCase();
  return /\brelocation\b|релокац|переезд|\brelocate\b/.test(v);
}

function detectVisaSupport(text: string): boolean {
  const v = text.toLowerCase();
  return /\bvisa\b|виза|visa\s+support|work\s+permit|разрешени[ея]\s+на\s+работу/.test(v);
}

function removeGluedCompany(text: string): string {
  // Удаляем склеенные названия компаний из текста локации
  // Примеры: "СербияITea" -> "Сербия", "данныхITea" -> "данных", "RS, СербияITea" -> "RS, Сербия", "БелградМеждународная" -> "Белград"
  
  // Паттерн 0: кириллическая строчная буква + кириллическая заглавная буква (например, "БелградМеждународная")
  // Ищем переход от кириллической строчной к кириллической заглавной
  const gluedRe0 = /([А-Яа-яЁё0-9\s,/-]+[а-яё])([А-ЯЁ][А-Яа-яЁё0-9]{2,40})(?=\s|$|,|:)/;
  const match0 = gluedRe0.exec(text);
  if (match0 && match0.index !== undefined) {
    const beforePart = match0[1]?.trim() || '';
    const wordPart = match0[2]?.trim() || '';
    if (beforePart.length > 2 && wordPart.length >= 2) {
      // Проверяем, что перед словом есть достаточно текста (не просто случайное совпадение)
      if (beforePart.length > 3) {
        return beforePart;
      }
    }
  }
  
  // Паттерн 1: кириллическая буква + латинская заглавная буква (например, "СербияITea")
  // Ищем переход от кириллицы к латинице с заглавной буквы
  const gluedRe1 = /([А-Яа-яЁё0-9\s,/-]+)([A-Z][A-Za-z0-9\s&'.-]{2,40})(?=\s|$|,|:)/;
  const match1 = gluedRe1.exec(text);
  if (match1 && match1.index !== undefined) {
    const beforePart = match1[1]?.trim() || '';
    const companyPart = match1[2]?.trim() || '';
    if (beforePart.length > 2 && /[А-Яа-яЁё]/.test(beforePart) && /^[A-Z]/.test(companyPart)) {
      // Проверяем, что это не просто код страны (RS, UK и т.д.) в начале
      // Если перед компанией есть запятая и короткий код, это может быть "RS, СербияITea"
      const hasCommaBefore = /,\s*[A-Z]{1,3}\s*$/.test(beforePart);
      if (!hasCommaBefore || beforePart.length > 15) {
        // Проверяем, что это не просто код страны
        if (!/^[A-Z]{1,3}$/.test(companyPart) || beforePart.length > 10) {
          // Исключаем валидные токены
          if (!/^(B2B|3D|C4D|iOS|iPad|iPhone|macOS|tvOS|watchOS|API|URL|HTTP|HTTPS|CSS|HTML|XML|JSON|PDF|JPG|PNG|GIF|SVG|MP4|AVI|MOV)$/i.test(companyPart)) {
            return beforePart;
          }
        }
      }
    }
  }
  
  // Паттерн 2: строчная буква + заглавная буква (например, "данныхITea")
  // Ищем переход от строчной к заглавной букве
  const gluedRe2 = /(.{3,})([a-zа-яё0-9])([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9]{1,30})(?=\s|$|,|:)/;
  const match2 = gluedRe2.exec(text);
  if (match2 && match2.index !== undefined) {
    const beforePart = (match2[1] + match2[2]).trim();
    const companyPart = match2[3]?.trim() || '';
    if (beforePart.length > 3 && companyPart.length >= 2 && /^[A-ZА-ЯЁ]/.test(companyPart)) {
      // Проверяем, что компания не слишком короткая (может быть случайное совпадение)
      if (companyPart.length >= 3 || beforePart.length > 10) {
        // Исключаем валидные токены
        if (!/^(B2B|3D|C4D|iOS|iPad|iPhone|macOS|tvOS|watchOS|API|URL|HTTP|HTTPS|CSS|HTML|XML|JSON|PDF|JPG|PNG|GIF|SVG|MP4|AVI|MOV)$/i.test(companyPart)) {
          return beforePart;
        }
      }
    }
  }
  
  // Паттерн 3: обработка формата "RS, СербияITea" - нужно отделить компанию от города после запятой
  const commaMatch = /^([^,]+,\s*[^,]+)([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9]{2,30})(?=\s|$|,|:)/;
  const commaResult = commaMatch.exec(text);
  if (commaResult && commaResult.index !== undefined) {
    const beforeCompany = commaResult[1]?.trim() || '';
    const companyPart = commaResult[2]?.trim() || '';
    // Проверяем, что перед компанией есть кириллический текст (город/страна)
    if (beforeCompany.length > 5 && /[А-Яа-яЁё]/.test(beforeCompany) && /^[A-Z]/.test(companyPart)) {
      // Исключаем валидные токены
      if (!/^(B2B|3D|C4D|iOS|iPad|iPhone|macOS|tvOS|watchOS|API|URL|HTTP|HTTPS|CSS|HTML|XML|JSON|PDF|JPG|PNG|GIF|SVG|MP4|AVI|MOV)$/i.test(companyPart)) {
        return beforeCompany;
      }
    }
  }
  
  return text;
}

function tryExplicitCityCountry(text: string): { city: string | null; country: string | null; index: number; len: number } | null {
  // formats like "Москва, РФ" or "Berlin, Germany" or "г. Москва"
  // Сначала очищаем склеенный текст
  const cleanedText = removeGluedCompany(text);
  const m1 = /(г\.?\s*)?([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})\s*,\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})/i.exec(cleanedText);
  if (m1 && m1.index !== undefined) {
    const full = m1[0];
    // avoid matching emails/urls like "example.com, https" or "mail@x.com, apply"
    if (/@|:\/\//.test(full)) {
      return null;
    }
    const city = m1[2].trim();
    const countryRaw = m1[3].trim();
    // avoid false positives like "Office in Tbilisi, hybrid format"
    const cityWords = city.split(/\s+/).filter(Boolean);
    const countryWords = countryRaw.split(/\s+/).filter(Boolean);
    const cityLower = city.toLowerCase();
    const countryLower = countryRaw.toLowerCase();
    if (cityWords.length > 3 || countryWords.length > 3) {
      return null;
    }
    if (/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
      return null;
    }
    if (/формат|гибрид|удал|office|remote|onsite|hybrid/.test(countryLower)) {
      return null;
    }

    // Prevent false positives on tech stacks like "Django, FastAPI"
    if (city.includes('.') || countryRaw.includes('.')) {
      return null;
    }
    if (isCamelLike(city) || isCamelLike(countryRaw)) {
      return null;
    }
    if (NON_LOCATION_TOKENS.has(cityLower) || NON_LOCATION_TOKENS.has(countryLower)) {
      return null;
    }
    if (BANNED_LOCATION_WORDS.has(cityLower) || BANNED_LOCATION_WORDS.has(countryLower)) {
      return null;
    }
    if (cityLower.length <= 2) {
      return null;
    }
    if (isAllLowerAsciiWords(city) && isAllLowerAsciiWords(countryRaw)) {
      return null;
    }
    if (!isKnownCountryToken(countryRaw)) {
      return null;
    }
    return { city, country: countryRaw, index: m1.index, len: m1[0].length };
  }

  // Formats like "Berlin (Germany)" or "Dublin (IE)"
  const mParens = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})\s*\(\s*([A-Za-zА-Яа-яЁё]{2,40})\s*\)/i.exec(text);
  if (mParens && mParens.index !== undefined) {
    const full = mParens[0];
    if (/@|:\/\//.test(full)) {
      return null;
    }
    const city = mParens[1].trim();
    const countryRaw = mParens[2].trim();
    const cityLower = city.toLowerCase();
    const countryLower = countryRaw.toLowerCase();
    if (/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
      return null;
    }
    if (/формат|гибрид|удал|office|remote|onsite|hybrid/.test(countryLower)) {
      return null;
    }
    if (NON_LOCATION_TOKENS.has(cityLower) || NON_LOCATION_TOKENS.has(countryLower)) {
      return null;
    }
    if (BANNED_LOCATION_WORDS.has(cityLower) || BANNED_LOCATION_WORDS.has(countryLower)) {
      return null;
    }
    if (cityLower.length <= 2) {
      return null;
    }
    if (isAllLowerAsciiWords(city) && isAllLowerAsciiWords(countryRaw)) {
      return null;
    }
    if (!isKnownCountryToken(countryRaw)) {
      return null;
    }
    return { city, country: countryRaw, index: mParens.index, len: mParens[0].length };
  }

  // Formats like "Berlin - Germany"
  const mDash = /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})\s*[-–—]\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{1,40})/i.exec(text);
  if (mDash && mDash.index !== undefined) {
    const full = mDash[0];
    if (/@|:\/\//.test(full)) {
      return null;
    }
    const city = mDash[1].trim();
    const countryRaw = mDash[2].trim();
    const cityLower = city.toLowerCase();
    const countryLower = countryRaw.toLowerCase();
    if (/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
      return null;
    }
    if (/формат|гибрид|удал|office|remote|onsite|hybrid/.test(countryLower)) {
      return null;
    }
    if (NON_LOCATION_TOKENS.has(cityLower) || NON_LOCATION_TOKENS.has(countryLower)) {
      return null;
    }
    if (BANNED_LOCATION_WORDS.has(cityLower) || BANNED_LOCATION_WORDS.has(countryLower)) {
      return null;
    }
    if (cityLower.length <= 2) {
      return null;
    }
    if (isAllLowerAsciiWords(city) && isAllLowerAsciiWords(countryRaw)) {
      return null;
    }
    if (!isKnownCountryToken(countryRaw)) {
      return null;
    }
    return { city, country: countryRaw, index: mDash.index, len: mDash[0].length };
  }

  // US format: "City, ST" (e.g., "New York, NY")
  const mUs = /([A-Za-z][A-Za-z .'-]{1,40})\s*,\s*([A-Z]{2})\b/.exec(text);
  if (mUs && mUs.index !== undefined) {
    const city = mUs[1].trim();
    const state = mUs[2].trim().toUpperCase();
    if (US_STATE_CODES.has(state)) {
      const cityLower = city.toLowerCase();
      if (!/\boffice\b|\bformat\b|\bhybrid\b|\bremote\b|\bonsite\b/.test(cityLower)) {
        return { city, country: 'USA', index: mUs.index, len: mUs[0].length };
      }
    }
  }

  const m2 = /(г\.?\s*)([А-Яа-яЁё][А-Яа-яЁё\- ]{1,40})/i.exec(text);
  if (m2 && m2.index !== undefined) {
    const city = m2[2].trim();
    return { city, country: null, index: m2.index, len: m2[0].length };
  }

  return null;
}

function normalizeCountry(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  for (const a of COUNTRY_ALIASES) {
    if (a.re.test(value)) {
      return a.country;
    }
  }
  // keep as-is for now (minimal)
  return value;
}

function normalizeCity(raw: string | null): { city: string | null; countryHint: string | null } {
  if (!raw) {
    return { city: null, countryHint: null };
  }
  // Сначала очищаем склеенный текст (например, "СербияITea" -> "Сербия")
  const cleaned = removeGluedCompany(raw.trim());
  if (!cleaned) {
    return { city: null, countryHint: null };
  }
  for (const a of CITY_ALIASES) {
    if (a.re.test(cleaned)) {
      return { city: a.city, countryHint: a.country ?? null };
    }
  }
  return { city: cleaned, countryHint: null };
}

function findBestHit(hits: Hit[]): Hit | null {
  if (hits.length === 0) {
    return null;
  }
  hits.sort((a, b) => b.score - a.score);
  return hits[0];
}

function detectRegionOnly(text: string): Array<'US' | 'EU' | 'EMEA' | 'APAC'> {
  const v = text.toLowerCase();
  const out: Array<'US' | 'EU' | 'EMEA' | 'APAC'> = [];
  if (/\b(us\s+only|usa\s+only|united\s+states\s+only)\b/.test(v)) {
    out.push('US');
  }
  if (/\b(eu\s+only|european\s+union\s+only|eu-wide|eea\s+only|europe\s+only)\b/.test(v)) {
    out.push('EU');
  }
  if (/\bemea\b/.test(v)) {
    out.push('EMEA');
  }
  if (/\bapac\b/.test(v)) {
    out.push('APAC');
  }
  return out;
}

export function extractLocation(
  ctx: DocumentContext,
  opts: { enableTraces: boolean },
): LocationExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  // flags are global signals (may exist without an explicit city/country mention)
  const relocationFlag = detectRelocation(ctx.normalizedText);
  const visaSupportFlag = detectVisaSupport(ctx.normalizedText);
  const regions = detectRegionOnly(ctx.normalizedText);

  const hits: Hit[] = [];

  for (const section of ctx.sections) {
    const text = section.text;
    if (!text) {
      continue;
    }

    // Avoid matching country codes (ru/us/uk/etc.) from URLs/emails.
    const textNoUrls = text
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ');

    const relocation = detectRelocation(text);
    const visaSupport = detectVisaSupport(text);

    // Очищаем текст от склеенных названий компаний перед поиском локаций
    const cleanedTextNoUrls = removeGluedCompany(textNoUrls);
    const explicit = tryExplicitCityCountry(cleanedTextNoUrls);
    if (explicit) {
      const cityNorm = normalizeCity(explicit.city);
      const countryNorm = normalizeCountry(explicit.country) ?? cityNorm.countryHint;
      const snippet = snippetAround(text, explicit.index, explicit.len);
      hits.push({
        city: cityNorm.city,
        country: countryNorm,
        relocation,
        visaSupport,
        section: section.name,
        snippet,
        score: sectionWeight(section.name) + 3,
        ruleId: 'regex:city_country',
      });
    }

    // city-only aliases
    for (const a of CITY_ALIASES) {
      const m = a.re.exec(cleanedTextNoUrls);
      if (m && m.index !== undefined) {
        hits.push({
          city: a.city,
          country: a.country ?? null,
          relocation,
          visaSupport,
          section: section.name,
          snippet: snippetAround(text, m.index, m[0].length),
          score: sectionWeight(section.name) + 2,
          ruleId: 'dict:city',
        });
      }
    }

    // country-only aliases
    for (const a of COUNTRY_ALIASES) {
      const m = a.re.exec(textNoUrls);
      if (m && m.index !== undefined) {
        hits.push({
          city: null,
          country: a.country,
          relocation,
          visaSupport,
          section: section.name,
          snippet: snippetAround(text, m.index, m[0].length),
          score: sectionWeight(section.name) + 1,
          ruleId: 'dict:country',
        });
      }
    }
  }

  const best = findBestHit(hits);

  const relocation = relocationFlag || hits.some((h) => h.relocation);
  const visaSupport = visaSupportFlag || hits.some((h) => h.visaSupport);

  const defaultCountryName = countryFromDefault(ctx.defaultCountry);
  const countryFallback = best?.country ?? (/кипр/iu.test(ctx.normalizedText) ? 'Cyprus' : null) ?? defaultCountryName;

  const value: LocationInfo = {
    city: best?.city ?? null,
    country: countryFallback,
    relocation,
    visaSupport,
  };

  const hasAny = Boolean(value.city || value.country || relocation || visaSupport);
  const confidence = !hasAny ? 0 : Math.min(1, 0.3 + Math.min(8, (best?.score ?? 1)) * 0.1);

  if (!hasAny) {
    warnings.push('location_not_found');
  }

  if (!value.city && !value.country && regions.length > 0) {
    for (const r of regions) {
      warnings.push(`location_region_only:${r}`);
    }
  }

  if (opts.enableTraces) {
    for (const h of hits.slice(0, 10)) {
      traces.push({
        extractor: 'location',
        ruleId: h.ruleId,
        section: h.section,
        snippet: h.snippet,
        scoreDelta: h.score,
      });
    }
  }

  return {
    location: { value },
    confidence,
    warnings,
    traces,
  };
}

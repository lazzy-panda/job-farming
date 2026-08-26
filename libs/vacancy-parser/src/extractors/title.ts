import type { DocumentContext } from '../core/document-context';
import { scoreToConfidence } from '../core/scoring';
import type { ParsedTitle, Role, RuleTrace } from '../model/types';
import { shouldSkipGluedToken } from './glued-company-helpers';

export interface TitleExtractResult {
  title: ParsedTitle;
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

type CandidateSource = 'pageTitle' | 'head' | 'caps' | 'pattern';

type Candidate = {
  source: CandidateSource;
  text: string;
  section: string;
  baseScore: number;
};

type RoleRule = { role: Role; re: RegExp };

type Level = ParsedTitle['level'];

const ROLE_RULES: RoleRule[] = [
  // Frontend
  { role: 'frontend_developer', re: /(front\s*-?end|frontend|фронт\s*-?енд|фронтенд|angular\s+developer|react\s+developer|vue\s+developer|vue\.js|ember|svelte|next\.js|nuxt|gatsby|web\s+developer|javascript\s+developer|typescript\s+developer|js\s+developer|ts\s+developer|front[-\s]?end\s+engineer|front[-\s]?end\s+programmer|front[-\s]?end\s+specialist)/i },
  // Backend
  { role: 'backend_developer', re: /(back\s*-?end|backend|бэк\s*-?енд|бэкенд|server\s*-?side|node\.js\s+developer|nestjs\s+developer|java\s+developer|golang\s+developer|go\s+developer|python\s+developer|php\s+developer|\.net\s+developer|dotnet\s+developer|c#\s+developer|c\+\+\s+developer|rust\s+developer|ruby\s+developer|ruby\s+on\s+rails|scala\s+developer|erlang\s+developer|elixir\s+developer|clojure\s+developer|haskell\s+developer|perl\s+developer|lua\s+developer|back[-\s]?end\s+engineer|back[-\s]?end\s+programmer|back[-\s]?end\s+specialist|server[-\s]?side\s+developer|server[-\s]?side\s+engineer)/i },
  // Fullstack
  { role: 'fullstack_developer', re: /(full\s*-?stack|fullstack|фулл\s*-?стек|фуллстек|full\s+stack)/i },
  // Mobile
  { role: 'mobile_developer', re: /(mobile\s+developer|мобильн\w+\s+разработчик|mobile\s+app\s+developer|flutter\s+developer|react\s+native\s+developer|xamarin\s+developer)/i },
  { role: 'ios_developer', re: /(ios\s+developer|swift\s+developer|objective[-\s]?c\s+developer|ios\s+app\s+developer|apple\s+developer)/i },
  { role: 'android_developer', re: /(android\s+developer|kotlin\s+developer|android\s+app\s+developer)/i },
  // QA
  { role: 'qa_engineer', re: /(qa\b|quality\s+assurance|тестировщик|qa\s+engineer|test\s+engineer|testing\s+engineer|quality\s+engineer|test\s+specialist|qa\s+specialist)/i },
  { role: 'automation_qa', re: /(automation\s+qa|qa\s+automation|автоматизац\w+\s+тестирован|test\s+automation|automated\s+testing|selenium|cypress|playwright|test\s+automation\s+engineer)/i },
  { role: 'manual_qa', re: /(manual\s+qa|ручн\w+\s+тестирован|manual\s+testing|manual\s+tester)/i },
  // DevOps & Infrastructure
  { role: 'devops_engineer', re: /(devops|девопс|dev\s+ops|infrastructure\s+engineer|platform\s+engineer|cloud\s+engineer|aws\s+engineer|azure\s+engineer|gcp\s+engineer|kubernetes\s+engineer|docker\s+engineer|terraform\s+engineer|ansible\s+engineer)/i },
  { role: 'sre', re: /(\bsre\b|site\s+reliability|site\s+reliability\s+engineer|reliability\s+engineer)/i },
  // Data
  { role: 'data_engineer', re: /(data\s+engineer|инженер\w+\s+данных|etl\s+developer|data\s+warehouse\s+engineer|big\s+data\s+engineer|spark\s+engineer|hadoop\s+engineer|data\s+pipeline\s+engineer|data\s+infrastructure\s+engineer|data\s+platform\s+engineer)/i },
  { role: 'data_scientist', re: /(data\s+scientist|дата\s+саентист|аналитик\w+\s+данных|data\s+analyst|data\s+science|machine\s+learning\s+scientist|research\s+scientist|data\s+researcher|statistical\s+analyst|quantitative\s+analyst)/i },
  { role: 'ml_engineer', re: /(ml\s+engineer|machine\s+learning\s+engineer|инженер\w+\s+машинного\s+обучения|ai\s+engineer|deep\s+learning\s+engineer|neural\s+network\s+engineer|computer\s+vision\s+engineer|nlp\s+engineer|natural\s+language\s+processing)/i },
  // Management
  { role: 'product_manager', re: /(product\s+manager|продакт\s+менеджер|менеджер\s+продукта|product\s+owner|\bpo\b|product\s+lead|head\s+of\s+product|vp\s+product|director\s+of\s+product)/i },
  { role: 'project_manager', re: /(project\s+manager|pm\b|проектн\w+\s+менеджер|program\s+manager|delivery\s+manager|implementation\s+manager)/i },
  // Analytics
  { role: 'business_analyst', re: /(business\s+analyst|бизнес\s*-?аналитик|ba\b|business\s+intelligence|bi\s+analyst|business\s+intelligence\s+analyst|financial\s+analyst|finance\s+analyst|data\s+analyst|analyst)/i },
  { role: 'system_analyst', re: /(system\s+analyst|системн\w+\s*-?аналитик|systems\s+analyst|it\s+analyst|technical\s+analyst)/i },
  // Design
  { role: 'ux_ui_designer', re: /(ux\s*\/\s*ui|ux\b|ui\b|ux\s+designer|ui\s+designer|web\s*designer|веб-?дизайнер|дизайнер\w+\s+интерфейсов|user\s+experience|user\s+interface|interaction\s+designer|ux\s+researcher|ui\s+ux)/i },
  { role: 'product_designer', re: /(product\s+designer|product\s+дизайнер|продуктов\w+\s+дизайнер|digital\s+product\s+designer)/i },
  { role: 'graphic_designer', re: /(graphic\s+designer|графическ\w+\s+дизайнер|motion\s+designer|3d\s+designer|3d\s+motion\s+designer|3d-?аниматор|3d\s+аниматор|моушн\s+дизайнер|visual\s+designer|brand\s+designer|logo\s+designer|illustrator|animator|2d\s+animator|3d\s+animator)/i },
  { role: 'graphic_designer', re: /(дизайнер|designer)/i },
  // Support & Security
  { role: 'support_engineer', re: /(support\s+engineer|техподдержк\w+|support|technical\s+support|customer\s+support|it\s+support|help\s+desk|support\s+specialist|support\s+analyst)/i },
  { role: 'security_engineer', re: /(security\s+engineer|инженер\w+\s+безопасности|infosec|cybersecurity|cyber\s+security|information\s+security|security\s+specialist|penetration\s+tester|security\s+analyst|security\s+architect)/i },
  // Architecture
  { role: 'solutions_architect', re: /(solutions\s+architect|solution\s+architect|enterprise\s+architect|system\s+architect|technical\s+architect|cloud\s+architect|software\s+architect)/i },
  { role: 'architect', re: /(\barchitect\b|архитектор|software\s+architect|system\s+architect)/i },
  // Leadership
  { role: 'cto', re: /(\bcto\b|chief\s+technology\s+officer|chief\s+technical\s+officer|техническ\w+\s+директор)/i },
  { role: 'team_lead', re: /(team\s+lead|тимлид|teamlead|team\s+leader|development\s+lead|engineering\s+lead)/i },
  { role: 'tech_lead', re: /(tech\s+lead|техлид|techlead|technical\s+lead|engineering\s+lead|senior\s+engineer)/i },
  // Agile & Process
  { role: 'scrum_master', re: /(scrum\s+master|скрам\s+мастер|agile\s+coach|scrum\s+coach)/i },
  // HR & Recruiting
  { role: 'hr_recruiter', re: /(recruiter|talent\s+acquisition|hr\s+manager|рекрутер|talent\s+acquisition\s+specialist|technical\s+recruiter|it\s+recruiter|headhunter|talent\s+sourcer|sourcer|hr\s+specialist|hr\s+business\s+partner|people\s+operations)/i },
  // Sales
  { role: 'sales_manager', re: /(sales\s+manager|account\s+executive|account\s+manager|business\s+development|sales\b|sales\s+representative|sales\s+executive|sales\s+director|sales\s+lead|bd\s+manager|business\s+development\s+manager|key\s+account\s+manager|inside\s+sales|outside\s+sales|sales\s+engineer|presales)/i },
  // Marketing
  { role: 'marketing_manager', re: /(marketing\s+manager|digital\s+marketing|performance\s+marketing|growth\s+marketer|marketing\b|marketing\s+specialist|marketing\s+director|marketing\s+lead|growth\s+hacker|growth\s+manager|brand\s+manager|product\s+marketing|seo\s+specialist|seo\s+manager|ppc\s+specialist|ppc\s+manager|sem\s+specialist|smm\s+manager|social\s+media\s+manager|social\s+media\s+marketing|email\s+marketing|affiliate\s+manager|traffic\s+manager|media\s+buyer|performance\s+marketer)/i },
  // Content
  { role: 'content_manager', re: /(content\s+manager|content\s+specialist|content\b|content\s+marketing|content\s+strategist|content\s+creator|content\s+writer|editor|copywriter|копирайтер|blogger|content\s+editor|editorial\s+manager)/i },
  { role: 'copywriter', re: /(copywriter|content\s+writer|writer\b|копирайтер|technical\s+writer|technical\s+writer|documentation\s+specialist|content\s+creator)/i },
  // Finance & Legal
  { role: 'accountant', re: /(accountant|bookkeeper|бухгалтер|financial\s+accountant|management\s+accountant|cost\s+accountant|tax\s+accountant|auditor|internal\s+auditor|external\s+auditor|financial\s+controller|finance\s+manager|treasurer|bookkeeper)/i },
  { role: 'lawyer', re: /(lawyer|legal\s+counsel|юрист|attorney|legal\s+advisor|legal\s+specialist|corporate\s+lawyer|contract\s+lawyer|ip\s+lawyer|labor\s+lawyer|paralegal|legal\s+assistant|compliance\s+officer|compliance\s+manager|regulatory\s+affairs)/i },
];

const SPECIALIZATION_TOKENS: Array<{ re: RegExp; value: string }> = [
  // Frontend frameworks & libraries
  { re: /(angular)/i, value: 'Angular' },
  { re: /(react)/i, value: 'React' },
  { re: /(vue\.js|vue)/i, value: 'Vue' },
  { re: /(svelte)/i, value: 'Svelte' },
  { re: /(ember\.js|ember)/i, value: 'Ember' },
  { re: /(next\.js|nextjs)/i, value: 'Next.js' },
  { re: /(nuxt\.js|nuxt)/i, value: 'Nuxt.js' },
  { re: /(gatsby)/i, value: 'Gatsby' },
  { re: /(remix)/i, value: 'Remix' },
  { re: /(astro)/i, value: 'Astro' },
  { re: /(solid\.js|solidjs)/i, value: 'Solid.js' },
  { re: /(qwik)/i, value: 'Qwik' },
  { re: /(preact)/i, value: 'Preact' },
  { re: /(lit|lit-element)/i, value: 'Lit' },
  { re: /(alpine\.js|alpinejs)/i, value: 'Alpine.js' },
  { re: /(stencil)/i, value: 'Stencil' },
  // Backend frameworks
  { re: /(nestjs|nest\s?js)/i, value: 'NestJS' },
  { re: /(express\.js|express)/i, value: 'Express' },
  { re: /(fastify)/i, value: 'Fastify' },
  { re: /(koa\.js|koa)/i, value: 'Koa' },
  { re: /(hapi\.js|hapi)/i, value: 'Hapi' },
  { re: /(django)/i, value: 'Django' },
  { re: /(flask)/i, value: 'Flask' },
  { re: /(fastapi|fast\s+api)/i, value: 'FastAPI' },
  { re: /(tornado)/i, value: 'Tornado' },
  { re: /(spring\s+boot|springboot)/i, value: 'Spring Boot' },
  { re: /(spring\s+framework|spring)/i, value: 'Spring' },
  { re: /(quarkus)/i, value: 'Quarkus' },
  { re: /(micronaut)/i, value: 'Micronaut' },
  { re: /(vert\.x|vertx)/i, value: 'Vert.x' },
  { re: /(play\s+framework|playframework)/i, value: 'Play Framework' },
  { re: /(laravel)/i, value: 'Laravel' },
  { re: /(symfony)/i, value: 'Symfony' },
  { re: /(codeigniter)/i, value: 'CodeIgniter' },
  { re: /(yii)/i, value: 'Yii' },
  { re: /(zend)/i, value: 'Zend' },
  { re: /(asp\.net|aspnet)/i, value: 'ASP.NET' },
  { re: /(rails|ruby\s+on\s+rails)/i, value: 'Ruby on Rails' },
  { re: /(sinatra)/i, value: 'Sinatra' },
  { re: /(phoenix)/i, value: 'Phoenix' },
  { re: /\bgin\b/i, value: 'Gin' },
  { re: /(echo)/i, value: 'Echo' },
  { re: /(fiber)/i, value: 'Fiber' },
  { re: /(beego)/i, value: 'Beego' },
  { re: /(revel)/i, value: 'Revel' },
  // Programming languages
  { re: /(node\.js|nodejs|\bnode\b)/i, value: 'Node.js' },
  { re: /(typescript|\bts\b)/i, value: 'TypeScript' },
  { re: /(javascript|\bjs\b)/i, value: 'JavaScript' },
  { re: /(python)/i, value: 'Python' },
  { re: /(golang|\bgo\b)/i, value: 'Go' },
  { re: /(java)/i, value: 'Java' },
  { re: /(kotlin)/i, value: 'Kotlin' },
  { re: /(swift)/i, value: 'Swift' },
  { re: /(c#|\.net|dotnet)/i, value: '.NET' },
  { re: /(php)/i, value: 'PHP' },
  { re: /(rust)/i, value: 'Rust' },
  { re: /(scala)/i, value: 'Scala' },
  { re: /(clojure)/i, value: 'Clojure' },
  { re: /(erlang)/i, value: 'Erlang' },
  { re: /(elixir)/i, value: 'Elixir' },
  { re: /(haskell)/i, value: 'Haskell' },
  { re: /(f#|fsharp)/i, value: 'F#' },
  { re: /(ocaml)/i, value: 'OCaml' },
  { re: /(dart)/i, value: 'Dart' },
  { re: /(c\+\+|cpp)/i, value: 'C++' },
  { re: /(\bc\b)/i, value: 'C' },
  { re: /(objective[-\s]?c|objc)/i, value: 'Objective-C' },
  { re: /(r\s+language|\br\b)/i, value: 'R' },
  { re: /(matlab)/i, value: 'MATLAB' },
  { re: /(julia)/i, value: 'Julia' },
  { re: /(lua)/i, value: 'Lua' },
  { re: /(perl)/i, value: 'Perl' },
  { re: /(ruby)/i, value: 'Ruby' },
  { re: /(crystal)/i, value: 'Crystal' },
  { re: /(nim)/i, value: 'Nim' },
  { re: /(zig)/i, value: 'Zig' },
  { re: /(vlang|v\s+language)/i, value: 'V' },
  // Mobile frameworks
  { re: /(react\s+native|reactnative)/i, value: 'React Native' },
  { re: /(flutter)/i, value: 'Flutter' },
  { re: /(xamarin)/i, value: 'Xamarin' },
  { re: /(ionic)/i, value: 'Ionic' },
  { re: /(cordova|phonegap)/i, value: 'Cordova' },
  { re: /(titanium)/i, value: 'Titanium' },
  { re: /(native\s+script|nativescript)/i, value: 'NativeScript' },
  // Databases
  { re: /(postgresql|postgres)/i, value: 'PostgreSQL' },
  { re: /(mysql)/i, value: 'MySQL' },
  { re: /(mariadb)/i, value: 'MariaDB' },
  { re: /(mongodb|mongo)/i, value: 'MongoDB' },
  { re: /(redis)/i, value: 'Redis' },
  { re: /(elasticsearch|elastic)/i, value: 'Elasticsearch' },
  { re: /(cassandra)/i, value: 'Cassandra' },
  { re: /(couchdb)/i, value: 'CouchDB' },
  { re: /(dynamodb|dynamo)/i, value: 'DynamoDB' },
  { re: /(oracle)/i, value: 'Oracle' },
  { re: /(sql\s+server|mssql)/i, value: 'SQL Server' },
  { re: /(sqlite)/i, value: 'SQLite' },
  { re: /(neo4j)/i, value: 'Neo4j' },
  { re: /(influxdb)/i, value: 'InfluxDB' },
  { re: /(clickhouse)/i, value: 'ClickHouse' },
  { re: /(timescaledb|timescale)/i, value: 'TimescaleDB' },
  { re: /(couchbase)/i, value: 'Couchbase' },
  { re: /(riak)/i, value: 'Riak' },
  { re: /(arangodb)/i, value: 'ArangoDB' },
  { re: /(faunadb|fauna)/i, value: 'FaunaDB' },
  { re: /(supabase)/i, value: 'Supabase' },
  { re: /(firebase)/i, value: 'Firebase' },
  { re: /(rethinkdb)/i, value: 'RethinkDB' },
  // ORMs & Database tools
  { re: /(prisma)/i, value: 'Prisma' },
  { re: /(sequelize)/i, value: 'Sequelize' },
  { re: /(typeorm)/i, value: 'TypeORM' },
  { re: /(mongoose)/i, value: 'Mongoose' },
  { re: /(sqlalchemy)/i, value: 'SQLAlchemy' },
  { re: /(django\s+orm)/i, value: 'Django ORM' },
  { re: /(hibernate)/i, value: 'Hibernate' },
  { re: /(jpa)/i, value: 'JPA' },
  { re: /(doctrine)/i, value: 'Doctrine' },
  { re: /(eloquent)/i, value: 'Eloquent' },
  { re: /(activerecord)/i, value: 'ActiveRecord' },
  { re: /(drizzle)/i, value: 'Drizzle' },
  { re: /(knex\.js|knex)/i, value: 'Knex.js' },
  // DevOps & Infrastructure
  { re: /(docker)/i, value: 'Docker' },
  { re: /(kubernetes|k8s)/i, value: 'Kubernetes' },
  { re: /(terraform)/i, value: 'Terraform' },
  { re: /(ansible)/i, value: 'Ansible' },
  { re: /(puppet)/i, value: 'Puppet' },
  { re: /(chef)/i, value: 'Chef' },
  { re: /(vagrant)/i, value: 'Vagrant' },
  { re: /(jenkins)/i, value: 'Jenkins' },
  { re: /(gitlab\s+ci|gitlabci)/i, value: 'GitLab CI' },
  { re: /(github\s+actions|githubactions)/i, value: 'GitHub Actions' },
  { re: /(circleci|circle\s+ci)/i, value: 'CircleCI' },
  { re: /(travis\s+ci|travisci)/i, value: 'Travis CI' },
  { re: /(jenkins)/i, value: 'Jenkins' },
  { re: /(argo\s+cd|argocd)/i, value: 'ArgoCD' },
  { re: /(helm)/i, value: 'Helm' },
  { re: /(prometheus)/i, value: 'Prometheus' },
  { re: /(grafana)/i, value: 'Grafana' },
  { re: /(elk\s+stack|elasticsearch.*logstash.*kibana)/i, value: 'ELK Stack' },
  { re: /(splunk)/i, value: 'Splunk' },
  { re: /(datadog)/i, value: 'Datadog' },
  { re: /(new\s+relic|newrelic)/i, value: 'New Relic' },
  { re: /(sentry)/i, value: 'Sentry' },
  { re: /(consul)/i, value: 'Consul' },
  { re: /(vault)/i, value: 'Vault' },
  { re: /(nomad)/i, value: 'Nomad' },
  { re: /(istio)/i, value: 'Istio' },
  { re: /(linkerd)/i, value: 'Linkerd' },
  { re: /(envoy)/i, value: 'Envoy' },
  { re: /(nginx)/i, value: 'Nginx' },
  { re: /(apache)/i, value: 'Apache' },
  { re: /(caddy)/i, value: 'Caddy' },
  { re: /(traefik)/i, value: 'Traefik' },
  // Cloud platforms
  { re: /(\baws\b|amazon\s+web\s+services)/i, value: 'AWS' },
  { re: /(azure)/i, value: 'Azure' },
  { re: /(gcp|google\s+cloud|google\s+cloud\s+platform)/i, value: 'GCP' },
  { re: /(digitalocean|digital\s+ocean)/i, value: 'DigitalOcean' },
  { re: /(heroku)/i, value: 'Heroku' },
  { re: /(vercel)/i, value: 'Vercel' },
  { re: /(netlify)/i, value: 'Netlify' },
  { re: /(cloudflare)/i, value: 'Cloudflare' },
  { re: /(linode)/i, value: 'Linode' },
  { re: /(vultr)/i, value: 'Vultr' },
  { re: /(alibaba\s+cloud|aliyun)/i, value: 'Alibaba Cloud' },
  { re: /(oracle\s+cloud)/i, value: 'Oracle Cloud' },
  { re: /(ibm\s+cloud)/i, value: 'IBM Cloud' },
  // Message queues & streaming
  { re: /(kafka)/i, value: 'Kafka' },
  { re: /(rabbitmq|rabbit\s+mq)/i, value: 'RabbitMQ' },
  { re: /(activemq|active\s+mq)/i, value: 'ActiveMQ' },
  { re: /(apache\s+pulsar|pulsar)/i, value: 'Apache Pulsar' },
  { re: /(nats)/i, value: 'NATS' },
  { re: /(redis\s+streams)/i, value: 'Redis Streams' },
  { re: /(amazon\s+sqs|sqs)/i, value: 'Amazon SQS' },
  { re: /(amazon\s+sns|sns)/i, value: 'Amazon SNS' },
  { re: /(zeromq|zmq)/i, value: 'ZeroMQ' },
  // Testing frameworks
  { re: /(jest)/i, value: 'Jest' },
  { re: /(mocha)/i, value: 'Mocha' },
  { re: /(jasmine)/i, value: 'Jasmine' },
  { re: /(cypress)/i, value: 'Cypress' },
  { re: /(playwright)/i, value: 'Playwright' },
  { re: /(puppeteer)/i, value: 'Puppeteer' },
  { re: /(selenium)/i, value: 'Selenium' },
  { re: /(webdriverio|wdio)/i, value: 'WebdriverIO' },
  { re: /(testcafe)/i, value: 'TestCafe' },
  { re: /(nightwatch)/i, value: 'Nightwatch' },
  { re: /(protractor)/i, value: 'Protractor' },
  { re: /(karma)/i, value: 'Karma' },
  { re: /(vitest)/i, value: 'Vitest' },
  { re: /(pytest)/i, value: 'pytest' },
  { re: /(unittest)/i, value: 'unittest' },
  { re: /(junit)/i, value: 'JUnit' },
  { re: /(testng)/i, value: 'TestNG' },
  { re: /(rspec)/i, value: 'RSpec' },
  { re: /(mocha)/i, value: 'Mocha' },
  { re: /(chai)/i, value: 'Chai' },
  { re: /(sinon)/i, value: 'Sinon' },
  { re: /(enzyme)/i, value: 'Enzyme' },
  { re: /(testing\s+library|react\s+testing\s+library)/i, value: 'React Testing Library' },
  // State management
  { re: /(redux)/i, value: 'Redux' },
  { re: /(mobx)/i, value: 'MobX' },
  { re: /(zustand)/i, value: 'Zustand' },
  { re: /(recoil)/i, value: 'Recoil' },
  { re: /(jotai)/i, value: 'Jotai' },
  { re: /(valtio)/i, value: 'Valtio' },
  { re: /(pinia)/i, value: 'Pinia' },
  { re: /(vuex)/i, value: 'Vuex' },
  { re: /(ngrx)/i, value: 'NgRx' },
  // Build tools & bundlers
  { re: /(webpack)/i, value: 'Webpack' },
  { re: /(vite)/i, value: 'Vite' },
  { re: /(rollup)/i, value: 'Rollup' },
  { re: /(parcel)/i, value: 'Parcel' },
  { re: /(esbuild)/i, value: 'esbuild' },
  { re: /(swc)/i, value: 'SWC' },
  { re: /(turbo)/i, value: 'Turborepo' },
  { re: /(nx)/i, value: 'Nx' },
  { re: /(lerna)/i, value: 'Lerna' },
  { re: /(babel)/i, value: 'Babel' },
  { re: /(eslint)/i, value: 'ESLint' },
  { re: /(prettier)/i, value: 'Prettier' },
  { re: /(typescript)/i, value: 'TypeScript' },
  // GraphQL
  { re: /(graphql)/i, value: 'GraphQL' },
  { re: /(apollo)/i, value: 'Apollo' },
  { re: /(relay)/i, value: 'Relay' },
  { re: /(hasura)/i, value: 'Hasura' },
  { re: /(prisma)/i, value: 'Prisma' },
  // Microservices & API
  { re: /(grpc)/i, value: 'gRPC' },
  { re: /(rest\s+api|restapi)/i, value: 'REST API' },
  { re: /(soap)/i, value: 'SOAP' },
  { re: /(openapi|swagger)/i, value: 'OpenAPI' },
  { re: /(kong)/i, value: 'Kong' },
  { re: /(tyk)/i, value: 'Tyk' },
  { re: /(api\s+gateway)/i, value: 'API Gateway' },
  // AI/ML frameworks
  { re: /(tensorflow)/i, value: 'TensorFlow' },
  { re: /(pytorch|py\s+torch)/i, value: 'PyTorch' },
  { re: /(keras)/i, value: 'Keras' },
  { re: /(scikit[-\s]?learn|sklearn)/i, value: 'Scikit-learn' },
  { re: /(pandas)/i, value: 'Pandas' },
  { re: /(numpy)/i, value: 'NumPy' },
  { re: /(opencv)/i, value: 'OpenCV' },
  { re: /(spark)/i, value: 'Apache Spark' },
  { re: /(hadoop)/i, value: 'Hadoop' },
  { re: /(airflow)/i, value: 'Airflow' },
  { re: /(kubeflow)/i, value: 'Kubeflow' },
  { re: /(mlflow)/i, value: 'MLflow' },
  { re: /(jupyter)/i, value: 'Jupyter' },
  { re: /(hugging\s+face|transformers)/i, value: 'Hugging Face' },
  // Blockchain
  { re: /(blockchain)/i, value: 'Blockchain' },
  { re: /(ethereum)/i, value: 'Ethereum' },
  { re: /(solidity)/i, value: 'Solidity' },
  { re: /(web3)/i, value: 'Web3' },
  { re: /(hyperledger)/i, value: 'Hyperledger' },
  { re: /(bitcoin)/i, value: 'Bitcoin' },
  // CSS frameworks & preprocessors
  { re: /(tailwind\s+css|tailwind)/i, value: 'Tailwind CSS' },
  { re: /(bootstrap)/i, value: 'Bootstrap' },
  { re: /(material[-\s]?ui|mui)/i, value: 'Material-UI' },
  { re: /(ant\s+design|antd)/i, value: 'Ant Design' },
  { re: /(chakra\s+ui|chakra)/i, value: 'Chakra UI' },
  { re: /(styled[-\s]?components|styledcomponents)/i, value: 'Styled Components' },
  { re: /(emotion)/i, value: 'Emotion' },
  { re: /(sass|scss)/i, value: 'Sass' },
  { re: /(less)/i, value: 'Less' },
  { re: /(stylus)/i, value: 'Stylus' },
  { re: /(postcss)/i, value: 'PostCSS' },
  { re: /(css[-\s]?modules)/i, value: 'CSS Modules' },
  // Version control
  { re: /(git)/i, value: 'Git' },
  { re: /(svn|subversion)/i, value: 'SVN' },
  { re: /(mercurial|hg)/i, value: 'Mercurial' },
  // Package managers
  { re: /(npm)/i, value: 'npm' },
  { re: /(yarn)/i, value: 'Yarn' },
  { re: /(pnpm)/i, value: 'pnpm' },
  { re: /(pip)/i, value: 'pip' },
  { re: /(poetry)/i, value: 'Poetry' },
  { re: /(conda)/i, value: 'Conda' },
  { re: /(maven)/i, value: 'Maven' },
  { re: /(gradle)/i, value: 'Gradle' },
  { re: /(composer)/i, value: 'Composer' },
  { re: /(cargo)/i, value: 'Cargo' },
  { re: /(nuget)/i, value: 'NuGet' },
  // Game engines
  { re: /(unity)/i, value: 'Unity' },
  { re: /(unreal\s+engine|unreal)/i, value: 'Unreal Engine' },
  { re: /(godot)/i, value: 'Godot' },
  { re: /(cocos2d)/i, value: 'Cocos2d' },
  // Other tools
  { re: /(figma)/i, value: 'Figma' },
  { re: /(sketch)/i, value: 'Sketch' },
  { re: /(adobe\s+xd|xd)/i, value: 'Adobe XD' },
  { re: /(postman)/i, value: 'Postman' },
  { re: /(insomnia)/i, value: 'Insomnia' },
  { re: /(jira)/i, value: 'Jira' },
  { re: /(confluence)/i, value: 'Confluence' },
  { re: /(slack)/i, value: 'Slack' },
  { re: /(notion)/i, value: 'Notion' },
  // Design specializations
  { re: /(ui\s+design|user\s+interface\s+design)/i, value: 'UI Design' },
  { re: /(ux\s+design|user\s+experience\s+design)/i, value: 'UX Design' },
  { re: /(interaction\s+design)/i, value: 'Interaction Design' },
  { re: /(product\s+design)/i, value: 'Product Design' },
  { re: /(web\s+design)/i, value: 'Web Design' },
  { re: /(mobile\s+design)/i, value: 'Mobile Design' },
  { re: /(graphic\s+design)/i, value: 'Graphic Design' },
  { re: /(brand\s+design|branding)/i, value: 'Brand Design' },
  { re: /(logo\s+design)/i, value: 'Logo Design' },
  { re: /(packaging\s+design)/i, value: 'Packaging Design' },
  { re: /(print\s+design)/i, value: 'Print Design' },
  { re: /(editorial\s+design)/i, value: 'Editorial Design' },
  { re: /(illustration)/i, value: 'Illustration' },
  { re: /(motion\s+design|motion\s+graphics)/i, value: 'Motion Design' },
  { re: /(3d\s+design|3d\s+modeling)/i, value: '3D Design' },
  { re: /(animation)/i, value: 'Animation' },
  { re: /(vfx|visual\s+effects)/i, value: 'VFX' },
  { re: /(game\s+design)/i, value: 'Game Design' },
  { re: /(level\s+design)/i, value: 'Level Design' },
  { re: /(character\s+design)/i, value: 'Character Design' },
  { re: /(concept\s+art)/i, value: 'Concept Art' },
  { re: /(fashion\s+design)/i, value: 'Fashion Design' },
  { re: /(interior\s+design)/i, value: 'Interior Design' },
  { re: /(industrial\s+design)/i, value: 'Industrial Design' },
  // Marketing specializations
  { re: /(digital\s+marketing)/i, value: 'Digital Marketing' },
  { re: /(performance\s+marketing)/i, value: 'Performance Marketing' },
  { re: /(content\s+marketing)/i, value: 'Content Marketing' },
  { re: /(email\s+marketing)/i, value: 'Email Marketing' },
  { re: /(affiliate\s+marketing)/i, value: 'Affiliate Marketing' },
  { re: /(social\s+media\s+marketing|smm)/i, value: 'Social Media Marketing' },
  { re: /(seo|search\s+engine\s+optimization)/i, value: 'SEO' },
  { re: /(ppc|pay[-\s]?per[-\s]?click)/i, value: 'PPC' },
  { re: /(sem|search\s+engine\s+marketing)/i, value: 'SEM' },
  { re: /(google\s+ads)/i, value: 'Google Ads' },
  { re: /(facebook\s+ads|meta\s+ads)/i, value: 'Facebook Ads' },
  { re: /(instagram\s+marketing)/i, value: 'Instagram Marketing' },
  { re: /(linkedin\s+marketing)/i, value: 'LinkedIn Marketing' },
  { re: /(youtube\s+marketing)/i, value: 'YouTube Marketing' },
  { re: /(tiktok\s+marketing)/i, value: 'TikTok Marketing' },
  { re: /(influencer\s+marketing)/i, value: 'Influencer Marketing' },
  { re: /(growth\s+hacking|growth\s+marketing)/i, value: 'Growth Marketing' },
  { re: /(brand\s+marketing)/i, value: 'Brand Marketing' },
  { re: /(product\s+marketing)/i, value: 'Product Marketing' },
  { re: /(b2b\s+marketing)/i, value: 'B2B Marketing' },
  { re: /(b2c\s+marketing)/i, value: 'B2C Marketing' },
  { re: /(event\s+marketing)/i, value: 'Event Marketing' },
  { re: /(pr|public\s+relations)/i, value: 'Public Relations' },
  { re: /(media\s+buying)/i, value: 'Media Buying' },
  { re: /(traffic\s+management)/i, value: 'Traffic Management' },
  { re: /(web\s+analytics)/i, value: 'Web Analytics' },
  { re: /(conversion\s+optimization)/i, value: 'Conversion Optimization' },
  // Sales specializations
  { re: /(b2b\s+sales)/i, value: 'B2B Sales' },
  { re: /(b2c\s+sales)/i, value: 'B2C Sales' },
  { re: /(enterprise\s+sales)/i, value: 'Enterprise Sales' },
  { re: /(retail\s+sales)/i, value: 'Retail Sales' },
  { re: /(e[-\s]?commerce|ecommerce)/i, value: 'E-commerce' },
  { re: /(inside\s+sales)/i, value: 'Inside Sales' },
  { re: /(outside\s+sales|field\s+sales)/i, value: 'Outside Sales' },
  { re: /(key\s+account\s+management)/i, value: 'Key Account Management' },
  { re: /(channel\s+sales)/i, value: 'Channel Sales' },
  { re: /(partner\s+sales)/i, value: 'Partner Sales' },
  { re: /(territory\s+sales)/i, value: 'Territory Sales' },
  { re: /(saas\s+sales)/i, value: 'SaaS Sales' },
  { re: /(technical\s+sales)/i, value: 'Technical Sales' },
  { re: /(presales)/i, value: 'Pre-sales' },
  { re: /(business\s+development)/i, value: 'Business Development' },
  // HR specializations
  { re: /(talent\s+acquisition)/i, value: 'Talent Acquisition' },
  { re: /(recruiting)/i, value: 'Recruiting' },
  { re: /(technical\s+recruiting)/i, value: 'Technical Recruiting' },
  { re: /(executive\s+search|headhunting)/i, value: 'Executive Search' },
  { re: /(talent\s+sourcing)/i, value: 'Talent Sourcing' },
  { re: /(learning\s+&\s+development|ld)/i, value: 'Learning & Development' },
  { re: /(training)/i, value: 'Training' },
  { re: /(compensation\s+&\s+benefits|total\s+rewards)/i, value: 'Compensation & Benefits' },
  { re: /(hr\s+analytics)/i, value: 'HR Analytics' },
  { re: /(organizational\s+development)/i, value: 'Organizational Development' },
  { re: /(employee\s+relations)/i, value: 'Employee Relations' },
  { re: /(hr\s+business\s+partner)/i, value: 'HR Business Partner' },
  { re: /(people\s+operations)/i, value: 'People Operations' },
  { re: /(workplace\s+culture)/i, value: 'Workplace Culture' },
  { re: /(diversity\s+&\s+inclusion|d&i)/i, value: 'Diversity & Inclusion' },
  // Finance specializations
  { re: /(financial\s+analysis)/i, value: 'Financial Analysis' },
  { re: /(accounting)/i, value: 'Accounting' },
  { re: /(management\s+accounting)/i, value: 'Management Accounting' },
  { re: /(cost\s+accounting)/i, value: 'Cost Accounting' },
  { re: /(tax\s+accounting)/i, value: 'Tax Accounting' },
  { re: /(auditing)/i, value: 'Auditing' },
  { re: /(internal\s+audit)/i, value: 'Internal Audit' },
  { re: /(external\s+audit)/i, value: 'External Audit' },
  { re: /(financial\s+planning)/i, value: 'Financial Planning' },
  { re: /(investment\s+analysis)/i, value: 'Investment Analysis' },
  { re: /(risk\s+management)/i, value: 'Risk Management' },
  { re: /(credit\s+analysis)/i, value: 'Credit Analysis' },
  { re: /(treasury)/i, value: 'Treasury' },
  { re: /(corporate\s+finance)/i, value: 'Corporate Finance' },
  { re: /(m&a|mergers\s+&\s+acquisitions)/i, value: 'M&A' },
  { re: /(investment\s+banking)/i, value: 'Investment Banking' },
  { re: /(private\s+equity)/i, value: 'Private Equity' },
  { re: /(venture\s+capital)/i, value: 'Venture Capital' },
  { re: /(financial\s+modeling)/i, value: 'Financial Modeling' },
  { re: /(fp&a|financial\s+planning\s+&\s+analysis)/i, value: 'FP&A' },
  { re: /(bookkeeping)/i, value: 'Bookkeeping' },
  { re: /(payroll)/i, value: 'Payroll' },
  { re: /(accounts\s+payable)/i, value: 'Accounts Payable' },
  { re: /(accounts\s+receivable)/i, value: 'Accounts Receivable' },
  { re: /(budgeting)/i, value: 'Budgeting' },
  { re: /(forecasting)/i, value: 'Forecasting' },
  // Legal specializations
  { re: /(corporate\s+law)/i, value: 'Corporate Law' },
  { re: /(contract\s+law)/i, value: 'Contract Law' },
  { re: /(ip\s+law|intellectual\s+property)/i, value: 'IP Law' },
  { re: /(labor\s+law|employment\s+law)/i, value: 'Labor Law' },
  { re: /(tax\s+law)/i, value: 'Tax Law' },
  { re: /(compliance)/i, value: 'Compliance' },
  { re: /(regulatory\s+affairs)/i, value: 'Regulatory Affairs' },
  { re: /(data\s+protection|gdpr)/i, value: 'Data Protection' },
  { re: /(litigation)/i, value: 'Litigation' },
  { re: /(legal\s+research)/i, value: 'Legal Research' },
  { re: /(paralegal)/i, value: 'Paralegal' },
  // Medical specializations
  { re: /(general\s+practice|family\s+medicine)/i, value: 'General Practice' },
  { re: /(internal\s+medicine)/i, value: 'Internal Medicine' },
  { re: /(pediatrics)/i, value: 'Pediatrics' },
  { re: /(surgery)/i, value: 'Surgery' },
  { re: /(cardiology)/i, value: 'Cardiology' },
  { re: /(oncology)/i, value: 'Oncology' },
  { re: /(neurology)/i, value: 'Neurology' },
  { re: /(psychiatry)/i, value: 'Psychiatry' },
  { re: /(dermatology)/i, value: 'Dermatology' },
  { re: /(orthopedics)/i, value: 'Orthopedics' },
  { re: /(radiology)/i, value: 'Radiology' },
  { re: /(anesthesiology)/i, value: 'Anesthesiology' },
  { re: /(emergency\s+medicine)/i, value: 'Emergency Medicine' },
  { re: /(nursing)/i, value: 'Nursing' },
  { re: /(pharmacy)/i, value: 'Pharmacy' },
  { re: /(dentistry)/i, value: 'Dentistry' },
  { re: /(veterinary)/i, value: 'Veterinary' },
  // Education specializations
  { re: /(elementary\s+education)/i, value: 'Elementary Education' },
  { re: /(secondary\s+education)/i, value: 'Secondary Education' },
  { re: /(higher\s+education)/i, value: 'Higher Education' },
  { re: /(special\s+education)/i, value: 'Special Education' },
  { re: /(language\s+teaching)/i, value: 'Language Teaching' },
  { re: /(esl|english\s+as\s+second\s+language)/i, value: 'ESL' },
  { re: /(online\s+teaching|e[-\s]?learning)/i, value: 'Online Teaching' },
  { re: /(curriculum\s+development)/i, value: 'Curriculum Development' },
  { re: /(educational\s+technology)/i, value: 'Educational Technology' },
  { re: /(tutoring)/i, value: 'Tutoring' },
  { re: /(training)/i, value: 'Training' },
  { re: /(coaching)/i, value: 'Coaching' },
  // Engineering specializations
  { re: /(mechanical\s+engineering)/i, value: 'Mechanical Engineering' },
  { re: /(electrical\s+engineering)/i, value: 'Electrical Engineering' },
  { re: /(civil\s+engineering)/i, value: 'Civil Engineering' },
  { re: /(chemical\s+engineering)/i, value: 'Chemical Engineering' },
  { re: /(industrial\s+engineering)/i, value: 'Industrial Engineering' },
  { re: /(aerospace\s+engineering)/i, value: 'Aerospace Engineering' },
  { re: /(automotive\s+engineering)/i, value: 'Automotive Engineering' },
  { re: /(biomedical\s+engineering)/i, value: 'Biomedical Engineering' },
  { re: /(environmental\s+engineering)/i, value: 'Environmental Engineering' },
  { re: /(structural\s+engineering)/i, value: 'Structural Engineering' },
  { re: /(software\s+engineering)/i, value: 'Software Engineering' },
  { re: /(systems\s+engineering)/i, value: 'Systems Engineering' },
  { re: /(quality\s+engineering)/i, value: 'Quality Engineering' },
  { re: /(process\s+engineering)/i, value: 'Process Engineering' },
  { re: /(manufacturing\s+engineering)/i, value: 'Manufacturing Engineering' },
  // Construction & Architecture
  { re: /(architecture)/i, value: 'Architecture' },
  { re: /(landscape\s+architecture)/i, value: 'Landscape Architecture' },
  { re: /(urban\s+planning)/i, value: 'Urban Planning' },
  { re: /(construction\s+management)/i, value: 'Construction Management' },
  { re: /(project\s+management)/i, value: 'Project Management' },
  { re: /(building\s+design)/i, value: 'Building Design' },
  { re: /(cad|computer[-\s]?aided\s+design)/i, value: 'CAD' },
  { re: /(bim|building\s+information\s+modeling)/i, value: 'BIM' },
  // Operations & Supply Chain
  { re: /(supply\s+chain\s+management)/i, value: 'Supply Chain Management' },
  { re: /(logistics)/i, value: 'Logistics' },
  { re: /(procurement)/i, value: 'Procurement' },
  { re: /(inventory\s+management)/i, value: 'Inventory Management' },
  { re: /(warehouse\s+management)/i, value: 'Warehouse Management' },
  { re: /(distribution)/i, value: 'Distribution' },
  { re: /(operations\s+management)/i, value: 'Operations Management' },
  { re: /(production\s+management)/i, value: 'Production Management' },
  { re: /(quality\s+control)/i, value: 'Quality Control' },
  { re: /(lean\s+manufacturing)/i, value: 'Lean Manufacturing' },
  { re: /(six\s+sigma)/i, value: 'Six Sigma' },
  // Content & Writing
  { re: /(content\s+writing)/i, value: 'Content Writing' },
  { re: /(copywriting)/i, value: 'Copywriting' },
  { re: /(technical\s+writing)/i, value: 'Technical Writing' },
  { re: /(creative\s+writing)/i, value: 'Creative Writing' },
  { re: /(blogging)/i, value: 'Blogging' },
  { re: /(journalism)/i, value: 'Journalism' },
  { re: /(editing)/i, value: 'Editing' },
  { re: /(proofreading)/i, value: 'Proofreading' },
  { re: /(translation)/i, value: 'Translation' },
  { re: /(localization)/i, value: 'Localization' },
  { re: /(transcription)/i, value: 'Transcription' },
  // Customer Service
  { re: /(customer\s+support)/i, value: 'Customer Support' },
  { re: /(customer\s+success)/i, value: 'Customer Success' },
  { re: /(customer\s+service)/i, value: 'Customer Service' },
  { re: /(help\s+desk)/i, value: 'Help Desk' },
  { re: /(call\s+center)/i, value: 'Call Center' },
  { re: /(technical\s+support)/i, value: 'Technical Support' },
  // Real Estate
  { re: /(real\s+estate)/i, value: 'Real Estate' },
  { re: /(property\s+management)/i, value: 'Property Management' },
  { re: /(commercial\s+real\s+estate)/i, value: 'Commercial Real Estate' },
  { re: /(residential\s+real\s+estate)/i, value: 'Residential Real Estate' },
  // Insurance
  { re: /(insurance)/i, value: 'Insurance' },
  { re: /(life\s+insurance)/i, value: 'Life Insurance' },
  { re: /(health\s+insurance)/i, value: 'Health Insurance' },
  { re: /(property\s+insurance)/i, value: 'Property Insurance' },
  { re: /(auto\s+insurance)/i, value: 'Auto Insurance' },
  { re: /(underwriting)/i, value: 'Underwriting' },
  { re: /(claims)/i, value: 'Claims' },
  // Consulting
  { re: /(management\s+consulting)/i, value: 'Management Consulting' },
  { re: /(it\s+consulting)/i, value: 'IT Consulting' },
  { re: /(financial\s+consulting)/i, value: 'Financial Consulting' },
  { re: /(strategy\s+consulting)/i, value: 'Strategy Consulting' },
  // Research
  { re: /(market\s+research)/i, value: 'Market Research' },
  { re: /(user\s+research)/i, value: 'User Research' },
  { re: /(scientific\s+research)/i, value: 'Scientific Research' },
  { re: /(data\s+research)/i, value: 'Data Research' },
];

function uniq(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.trim();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

function findTailWordStart(text: string, candidateStart: number): number {
  let idx = Math.max(0, Math.min(candidateStart, text.length));
  while (idx > 0) {
    const prev = text[idx - 1];
    if (/\s/.test(prev) || /[,.;:!?/\\|()[\]{}"'«»<>]/.test(prev) || /[-–—]/.test(prev)) {
      break;
    }
    idx--;
  }
  return idx;
}

function findTailWordEnd(text: string, wordStart: number): number {
  let idx = Math.max(0, Math.min(wordStart, text.length));
  while (idx < text.length) {
    const ch = text[idx];
    if (/\s/.test(ch) || /[,.;:!?/\\|()[\]{}"'«»<>]/.test(ch) || /[-–—]/.test(ch)) {
      break;
    }
    idx++;
  }
  return idx;
}

function extractTailWord(text: string, candidateStart: number): string {
  if (!text) {
    return '';
  }
  const start = findTailWordStart(text, candidateStart);
  const end = findTailWordEnd(text, start);
  return text.slice(start, end).trim();
}

function shouldSkipGluedCandidate(text: string, candidateStart: number, candidate: string): boolean {
  if (!candidate) {
    return true;
  }
  if (shouldSkipGluedToken(candidate)) {
    return true;
  }
  const tailWord = extractTailWord(text, candidateStart);
  if (tailWord && tailWord !== candidate && shouldSkipGluedToken(tailWord)) {
    return true;
  }
  return false;
}

function resolveCandidateStart(
  text: string,
  match: RegExpExecArray | null,
  candidate: string,
  fallback?: number,
): number {
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return Math.max(0, Math.min(fallback, text.length));
  }
  if (match?.index !== undefined && match[0]) {
    const relative = match[0].lastIndexOf(candidate);
    if (relative >= 0) {
      return match.index + relative;
    }
  }
  const idx = text.lastIndexOf(candidate);
  if (idx >= 0) {
    return idx;
  }
  return Math.max(0, text.length - candidate.length);
}

function cleanTitle(raw: string): string {
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/[•·●]+/g, ' ')
    .replace(/^[-–—:\s]+/, '')
    .replace(/\s*[-–—:\s]+$/, '')
    .trim();

  const withoutPrefix = cleaned
    // common label prefixes (":" is optional, some channels write "Вакансия 100 тыс. руб.")
    .replace(/^(?:вакансия|позиция|position)(?:(?:\s+|[:\-–—]\s*))/i, '')
    .replace(/^(требуетс[яь]|требуются)\s+/i, '')
    .replace(/^we\s+are\s+looking\s+for\s+/i, '')
    .replace(/^we\s+need\s+/i, '')
    .replace(/^looking\s+for\s+/i, '')
    .replace(/^ищем\s+/i, '')
    .replace(/^мы\s+ищем\s+/i, '')
    .replace(/^нам\s+нужн(?:а|о|ы)\s+/i, '')
    .trim();

  // Remove leading hashtags often used in Telegram posts: "#вакансия #ищу ..."
  // Some channels prepend lots of tags; we strip up to 30.
  const withoutLeadingTags = withoutPrefix
    // leading bracket tags like "(#Москва)" / "(Москва)"
    .replace(/^(?:\(\s*#?[A-Za-zА-Яа-яЁё0-9_-]{2,30}\s*\)\s*){1,5}/, '')
    // leading hashtags
    .replace(/^(?:#\S+\s*){1,30}/, '')
    .trim();

  // Normalize glued boundaries (mostly Cyrillic) inside a single line title candidate.
  const deglued = withoutLeadingTags.replace(/([а-яё])([А-ЯЁ])/g, '$1 $2');

  // Some sources start with non-title blocks (scraping artifacts).
  if (/^(описание\s+(?:вакансии|стажировки)\s*:)/i.test(deglued)) {
    return '';
  }
  if (/^(source|источник|канал|channel)\s*[:\-]/i.test(deglued)) {
    return '';
  }
  // Obvious non-vacancy promo posts in job channels.
  if (/^(последн(ее|яя)\s+спецпредложение|анонсируем\s+акцию|акци[яи]\b|промокод\b)/i.test(deglued)) {
    return '';
  }

  // Remove URLs/emails from title candidates to avoid rejecting valid titles
  // (title is often followed by "(https://...)" in glued text).
  const withoutLinks = deglued
    .replace(/\(\s*https?:\/\/[^\s)]+\s*\)/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '')
    .replace(/\(\s*\)/g, '')
    // remove inline hashtags inside titles: "#менеджер" -> "менеджер"
    .replace(/#([A-Za-zА-Яа-яЁё0-9_+-]{2,})/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove leading salary label fragments that appear BEFORE the role.
  // Example: "+/- 100 тыс. руб. Контент-менеджер ..." -> "Контент-менеджер ..."
  const leadingSalaryLabelRe =
    /^(?:\+\/-|\+|-)?\s*\d{1,3}(?:[ \t.,'’]\d{3})*\s*(?:тыс\.?)?\s*(?:₽|руб\.?|rub|usd|eur|gbp|chf|pln|sek|nok|dkk|ron|bgn|\$|€|£)\.?\s*/i;
  const leadingSalaryM = leadingSalaryLabelRe.exec(withoutLinks);
  const withoutLeadingSalaryLabel =
    leadingSalaryM && leadingSalaryM.index === 0 ? withoutLinks.slice(leadingSalaryM[0].length).trim() : withoutLinks;

  // Cut off inline salary part if it is glued to the title (e.g. "Junior веб-дизайнер90 000 RUB...")
  // Also support amounts starting with 1 digit when using thousand groups: "1 500 $" / "1.800 €"
  const inlineSalaryRe =
    /\b(?:от\s*)?\d{1,3}(?:[ \t.,'’]\d{3})+(?:\s*(?:до|–|—|-|to)\s*\d{1,3}(?:[ \t.,'’]\d{3})+)?\s*(?:₽|RUB|USD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|RON|BGN|\$|€|£)\b/i;
  const salaryM = inlineSalaryRe.exec(withoutLeadingSalaryLabel);
  const withoutInlineSalary = (() => {
    if (!salaryM || salaryM.index === undefined) {
      return withoutLeadingSalaryLabel;
    }
    // Salary at the very beginning is often a label before the role ("Вакансия 100 тыс. руб. Контент-менеджер").
    // In such cases we want to REMOVE the salary chunk and keep the rest.
    if (salaryM.index <= 12) {
      const before = withoutLeadingSalaryLabel.slice(0, salaryM.index);
      const after = withoutLeadingSalaryLabel.slice(salaryM.index + salaryM[0].length);
      return `${before} ${after}`.replace(/\s+/g, ' ').trim();
    }
    // Otherwise treat it as a suffix glued to title and cut it off.
    return withoutLeadingSalaryLabel.slice(0, salaryM.index).trim();
  })();

  // Also cut common "100 тыс. руб." inline salary fragments.
  const inlineSalaryShortRe =
    /(?:\+\/-|\+|-)?\s*\d{1,3}(?:[ \t.,'’]\d{3})*\s*(?:тыс\.?|k)\s*(?:₽|руб\.?|rub|usd|eur|gbp|chf|pln|sek|nok|dkk|ron|bgn|\$|€|£)\b/i;
  const shortSalaryM = inlineSalaryShortRe.exec(withoutInlineSalary);
  const withoutInlineSalary2 = (() => {
    if (!shortSalaryM || shortSalaryM.index === undefined) {
      return withoutInlineSalary;
    }
    if (shortSalaryM.index <= 12) {
      const before = withoutInlineSalary.slice(0, shortSalaryM.index);
      const after = withoutInlineSalary.slice(shortSalaryM.index + shortSalaryM[0].length);
      return `${before} ${after}`.replace(/\s+/g, ' ').trim();
    }
    return withoutInlineSalary.slice(0, shortSalaryM.index).trim();
  })();

  // Cut plain amounts (with thousand groups) even if currency is missing in the title line.
  // Example: "Рекрутер 10 000" / "Node js2 000" -> drop the amount part.
  const inlineAmountRe = /\b\d{1,3}(?:[ \t.,'’]\d{3})+\b/;
  const amountM = inlineAmountRe.exec(withoutInlineSalary2);
  const withoutInlineAmount = (() => {
    if (!amountM || amountM.index === undefined) {
      return withoutInlineSalary2;
    }
    if (amountM.index <= 12) {
      const before = withoutInlineSalary2.slice(0, amountM.index);
      const after = withoutInlineSalary2.slice(amountM.index + amountM[0].length);
      return `${before} ${after}`.replace(/\s+/g, ' ').trim();
    }
    return withoutInlineSalary2.slice(0, amountM.index).trim();
  })();
  const withoutInlineAmount2 = withoutInlineAmount.replace(/(?:^|\s)(?:от|до|from|to)\s*$/i, '').trim();

  // Отделяем слипшееся название компании от названия должности
  // Примеры: "Finance / Data AnalystSTARTRIBE LTD" -> "Finance / Data Analyst"
  //          "Специалист по сверке данныхITea" -> "Специалист по сверке данных"
  //          "RS, СербияITea" -> "RS, Сербия"
  // Паттерны для названий компаний: LTD, LLC, INC, Corp, GmbH, ООО и т.д.
  const companySuffixRe =
    /\s*([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9\s&'.-]{2,50})\s*(?:LTD|LLC|INC|Corp|Corporation|GmbH|ООО|ЗАО|ПАО|ИП)\b(?:\s*[.,;:]\s*)?(?=$|\n)/i;
  const companyMatch = companySuffixRe.exec(withoutInlineAmount2);
  let withoutCompany = withoutInlineAmount2;
  if (companyMatch && companyMatch.index !== undefined && companyMatch.index > 10) {
    // Если название компании найдено и оно не в начале, отрезаем его
    withoutCompany = withoutInlineAmount2.slice(0, companyMatch.index).trim();
  } else {
    // Также пробуем найти слипшееся название компании без суффикса
    // Паттерн 1: заглавная буква после строчных/цифр (например, "AnalystSTARTRIBE", "данныхITea")
    // Ищем переход от строчной/цифры к заглавной букве (латиница или кириллица)
    // Важно: паттерн должен захватывать "AnalystSTARTRIBE" и "STARTRIBE LTD"
    const gluedCompanyRe1 =
      /([a-zа-яё0-9\s/&-]+)(?<!\s)([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9&'.-]{2,40})(?:\s*(?:LTD|LLC|INC|Corp|GmbH|ООО)\b)?\s*(?:[,.;:])?\s*$/;
    const gluedMatch1 = gluedCompanyRe1.exec(withoutInlineAmount2);
    if (gluedMatch1 && gluedMatch1.index !== undefined && gluedMatch1.index > 5) {
      const potentialCompany = gluedMatch1[2]?.trim() ?? '';
      const candidateStart = resolveCandidateStart(withoutInlineAmount2, gluedMatch1, potentialCompany);
      if (
        potentialCompany &&
        /^[A-ZА-ЯЁ]/.test(potentialCompany) &&
        potentialCompany.length >= 2 &&
        !shouldSkipGluedCandidate(withoutInlineAmount2, candidateStart, potentialCompany)
      ) {
        const prefixSlice = withoutInlineAmount2.slice(0, candidateStart).trim();
        if (prefixSlice.length > 3) {
          withoutCompany = prefixSlice;
        }
      }
    }
    
    // Паттерн 1a: специально для случая "AnalystSTARTRIBE" - заглавная латинская буква после строчной латинской
    if (withoutCompany === withoutInlineAmount2) {
      const gluedCompanyRe1a =
        /([a-z][a-z\s/&-]+)(?<!\s)([A-Z][A-Za-z0-9]{2,40})(?:\s*(?:LTD|LLC|INC|Corp|GmbH)\b)?\s*(?:[,.;:])?\s*$/;
      const gluedMatch1a = gluedCompanyRe1a.exec(withoutInlineAmount2);
      if (gluedMatch1a && gluedMatch1a.index !== undefined && gluedMatch1a.index > 5) {
        const potentialCompany = gluedMatch1a[2]?.trim() ?? '';
        const candidateStart = resolveCandidateStart(withoutInlineAmount2, gluedMatch1a, potentialCompany);
        if (
          potentialCompany &&
          potentialCompany.length >= 2 &&
          !shouldSkipGluedCandidate(withoutInlineAmount2, candidateStart, potentialCompany) &&
          withoutInlineAmount2.slice(0, candidateStart).trim().length > 3
        ) {
          const prefixSlice = withoutInlineAmount2.slice(0, candidateStart).trim();
          if (
            prefixSlice.length > 3 &&
            !/^(B2B|3D|C4D|iOS|iPad|iPhone|macOS|tvOS|watchOS|API|URL|HTTP|HTTPS|CSS|HTML|XML|JSON|PDF|JPG|PNG|GIF|SVG|MP4|AVI|MOV)$/i.test(
              potentialCompany,
            )
          ) {
            withoutCompany = prefixSlice;
          }
        }
      }
    }
    
    // Паттерн 2: заглавная буква (кириллица) + заглавная буква (латиница) - переход между языками
    // Пример: "СербияITea" - кириллическая заглавная "я" + латинская "I"
    // Ищем паттерн: кириллическая буква (включая заглавные) + латинская заглавная буква
    if (withoutCompany === withoutInlineAmount2) {
      const gluedCompanyRe2 =
        /([А-Яа-яЁё0-9\s,/-]+)(?<!\s)([A-Z][A-Za-z0-9&'.-]{2,40})\s*(?:[,.;:])?\s*$/;
      const gluedMatch2 = gluedCompanyRe2.exec(withoutInlineAmount2);
      if (gluedMatch2 && gluedMatch2.index !== undefined && gluedMatch2.index > 3) {
        const companyPart = gluedMatch2[2]?.trim() || '';
        const candidateStart = resolveCandidateStart(withoutInlineAmount2, gluedMatch2, companyPart);
        const prefixSlice = withoutInlineAmount2.slice(0, candidateStart).trim();
        if (
          prefixSlice.length > 3 &&
          /[А-Яа-яЁё]/.test(prefixSlice) &&
          /^[A-Z]/.test(companyPart) &&
          companyPart.length >= 2 &&
          !shouldSkipGluedCandidate(withoutInlineAmount2, candidateStart, companyPart)
        ) {
          if (!/^[A-Z]{1,3}$/.test(companyPart) || prefixSlice.length > 10) {
            withoutCompany = prefixSlice;
          }
        }
      }
    }
    
    // Паттерн 3: более общий - любая заглавная буква после строчной/цифры в конце строки
    // Пример: "данныхITea" - строчная "х" + заглавная "I"
    if (withoutCompany === withoutInlineAmount2) {
      const gluedCompanyRe3 = /(.{5,})([a-zа-яё0-9])([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9]{1,30})$/;
      const gluedMatch3 = gluedCompanyRe3.exec(withoutInlineAmount2);
      if (gluedMatch3 && gluedMatch3.index !== undefined) {
        const beforePart = gluedMatch3[1] + gluedMatch3[2];
        const companyPart = gluedMatch3[3]?.trim() || '';
        const candidateStart = resolveCandidateStart(
          withoutInlineAmount2,
          null,
          companyPart,
          withoutInlineAmount2.length - companyPart.length,
        );
        if (
          companyPart.length >= 2 &&
          /^[A-ZА-ЯЁ]/.test(companyPart) &&
          !shouldSkipGluedCandidate(withoutInlineAmount2, candidateStart, companyPart)
        ) {
          if (beforePart.trim().length > 5) {
            withoutCompany = beforePart.trim();
          }
        }
      }
    }
  }

  // Cut off common inline blocks that are often glued to the title (scraping artifacts)
  const stopRe =
    /(компания\s*:|компания\s+|company\s*:|company\s+|salary\s*:|compensation\s*:|заработн\w*\s*плат\w*|зарплат\w*|зп\s*:|оплата\s*:|формат\s*работ\w*|location\s*:|локац\w*\s*:|помога(?:ем|ют)\s+с\s+релокац\w*|help\w*\s+with\s+relocat\w*|relocat\w*\s+(?:package|support|assistance)|опыт\s+работы\s*:|график\s*:|рабочие\s+часы\s*:|выплаты\s*:|(?:^|\s)ип\s+[А-ЯЁ]|(?:^|\s)г\.?\s*[А-ЯЁ]|кто\s+мы\s*:|кого\s+мы\s+ищем(?:\s+и\s+почему)?\s*:|чем\s+вы\s+будете\s+заниматься\s*:|ключевые\s+навыки\s*:|хотите\s+к\s+нам\?\s*:|какие\s+задачи|мы\s+жд[её]м|что\s+мы\s+предлагаем|как\s+все\s+устроено|о\s+проекте\s*:|about\s+the\s+project\s*:|(?:^|\s)от\s+\d|from\s+\d|требовани\w*|обязанност\w*|requirements\b|responsibilities\b|benefits\b|описани[ея]\s*:|отклик\s*:|откликнутьс[яь]\b|apply\b|задача\s*:|задачи\s*:|с\s+опытом|with\s+experience|(?:австрийск|немецк|французск|итальянск|испанск|польск|британск|американск|швейцарск)[А-Яа-яЁё]+\s+(?:премиальн[А-Яа-яЁё]+\s+)?(?:бренд|компания|студия|agency|brand|startup))/i;
  const m = stopRe.exec(withoutCompany);
  const sliced = m && m.index > 0 ? withoutCompany.slice(0, m.index).trim() : withoutCompany;

  // Cut at common separators between title and company/description.
  const sepRe = /(\s[-–—]\s|\s\|\s)/;
  const sepIdx = sliced.search(sepRe);
  const maybeShortRaw = sepIdx > 10 ? sliced.slice(0, sepIdx).trim() : sliced;
  const maybeShort = maybeShortRaw.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '').trim();

  // If it's still a long sentence, keep only the first clause.
  const firstClause = (() => {
    const v = maybeShort.trim();
    if (v.length <= 80) {
      return v;
    }
    const commaIdx = v.indexOf(',');
    if (commaIdx > 10) {
      return v.slice(0, commaIdx).trim();
    }
    const dotIdx = v.indexOf('.');
    if (dotIdx > 10) {
      return v.slice(0, dotIdx).trim();
    }
    const dashIdx = v.search(/\s[-–—]\s/);
    if (dashIdx > 10) {
      return v.slice(0, dashIdx).trim();
    }
    return v;
  })();

  // Hard limit to avoid returning whole vacancy text as title.
  const MAX_TITLE_LENGTH = 180;
  return (firstClause.length > MAX_TITLE_LENGTH ? firstClause.slice(0, MAX_TITLE_LENGTH) : firstClause).trim();
}

function isAllCapsLike(text: string): boolean {
  const letters: string[] = text.match(/[A-Za-zА-Яа-яЁё]/g) ?? [];
  if (letters.length < 6) {
    return false;
  }
  const upper = letters.filter((c) => c === c.toUpperCase()).length;
  return upper / letters.length >= 0.85;
}

function looksLikeTitle(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  // Work format / schedule lines are often present in the first lines and can win by score.
  // Example: "Удаленка, парт-тайм" should NOT be treated as a job title.
  const workFormatTokensRe =
    /(удал[её]нк[\p{L}]*(?:а|о|е)?|удал[её]нно|remote|remotely|hybrid|onsite|on[-\s]*site|office|в\s+офисе|офис|part[-\s]*time|full[-\s]*time|парт[-\s]*тайм|фулл[-\s]*тайм|частичн[\p{L}]*\s+занятост[\p{L}]*|полн[\p{L}]*\s+занятост[\p{L}]*)/giu;
  const leftovers = t
    .toLowerCase()
    .replace(workFormatTokensRe, ' ')
    .replace(/[^a-zа-яё]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!leftovers) {
    return false;
  }
  if (t.length > 140) {
    return false;
  }
  // Not a title: metadata lines from scrapers/feeds.
  if (/^(source|источник|канал|channel)\s*[:\-]/i.test(t)) {
    return false;
  }
  if (/\b(requirements|responsibilities|обязанности|требования)\b/i.test(t)) {
    return false;
  }
  if (/\b(кто\s+мы|кого\s+мы\s+ищем|чем\s+вы\s+будете\s+заниматься|ключевые\s+навыки)\b/i.test(t)) {
    return false;
  }
  if (/https?:\/\//i.test(t)) {
    return false;
  }
  if (/\d{2,}\s*(?:₽|\$|€|usd|eur|rub|k|тыс)/i.test(t)) {
    // likely salary line
    return false;
  }
  return true;
}

function detectLevel(text: string): Level {
  const v = text.toLowerCase();
  if (/intern|internship|стаж(е|ё)р|стажировк/.test(v)) {
    return 'intern';
  }
  if (/junior|\bjr\b|джун/.test(v)) {
    return 'junior';
  }
  if (/middle|mid\b|мидл?/.test(v)) {
    return 'middle';
  }
  if (/senior|\bsr\b|сеньор|старш(ий|ая)/.test(v)) {
    return 'senior';
  }
  if (/lead|leading|лид|руководител/.test(v)) {
    return 'lead';
  }
  if (/principal|staff/.test(v)) {
    return 'principal';
  }
  return 'unknown';
}

function detectRole(text: string): { role: Role; ruleId: string | null } {
  for (const rr of ROLE_RULES) {
    if (rr.re.test(text)) {
      return { role: rr.role, ruleId: `role:${rr.role}` };
    }
  }
  return { role: 'unknown', ruleId: null };
}

function detectSpecialization(text: string): string[] {
  const out: string[] = [];
  for (const t of SPECIALIZATION_TOKENS) {
    if (t.re.test(text)) {
      out.push(t.value);
    }
  }
  return uniq(out);
}

function extractPatternCandidates(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  const patterns: RegExp[] = [
    /^\s*(?:вакансия|позиция)\s*[:\-]\s*(.+)$/i,
    /^\s*(?:position)\s*[:\-]\s*(.+)$/i,
    /^\s*(?:we\s+are\s+looking\s+for)\s+(.+)$/i,
    /^\s*(?:we\s+need)\s+(.+)$/i,
    /^\s*(?:looking\s+for)\s+(.+)$/i,
    // IMPORTANT: anchor to line start to avoid matching inside phrases like "Кого мы ищем..."
    /^\s*(?:ищем)\s+(.+)$/i,
    /^\s*(?:мы\s+ищем)\s+(.+)$/i,
    /^\s*(?:требуетс[яь])\s+(.+)$/i,
    /^\s*(?:требуются)\s+(.+)$/i,
    /^\s*(?:нужен|нужна|нужны)\s+(.+)$/i,
  ];
  for (const line of lines.slice(0, 20)) {
    for (const p of patterns) {
      const m = p.exec(line);
      if (!m) {
        continue;
      }
      const tail = m[m.length - 1];
      const cleaned = cleanTitle(tail);
      if (!cleaned) {
        continue;
      }
      out.push({ source: 'pattern', text: cleaned, section: 'head', baseScore: 3 });
    }
  }
  return out;
}

function buildCandidates(ctx: DocumentContext): Candidate[] {
  const candidates: Candidate[] = [];

  const pageTitle = ctx.pageTitle?.trim() ?? '';
  if (pageTitle) {
    candidates.push({ source: 'pageTitle', text: cleanTitle(pageTitle), section: 'head', baseScore: 3 });
  }

  const head = ctx.headLines.slice(0, 2);
  for (const line of head) {
    const cleaned = cleanTitle(line);
    if (!cleaned) {
      continue;
    }
    candidates.push({ source: 'head', text: cleaned, section: 'head', baseScore: 2 });
  }

  for (const line of ctx.headLines.slice(0, 10)) {
    const cleaned = cleanTitle(line);
    if (!cleaned) {
      continue;
    }
    if (isAllCapsLike(cleaned)) {
      candidates.push({ source: 'caps', text: cleaned, section: 'head', baseScore: 2 });
    }
  }

  candidates.push(...extractPatternCandidates(ctx.headLines));

  // de-dup by text
  const uniqOut: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.text.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqOut.push(c);
  }

  return uniqOut;
}

function scoreCandidate(c: Candidate): { score: number; role: Role; roleRuleId: string | null; level: Level; specialization: string[]; warnings: string[] } {
  const warnings: string[] = [];
  let score = c.baseScore;

  const text = c.text;

  if (looksLikeTitle(text)) {
    score += 1;
  }

  if (text.length > 90) {
    score -= 1;
  }

  if (/\b(requirements|responsibilities|обязанности|требования)\b/i.test(text)) {
    score -= 2;
    warnings.push('title_looks_like_section');
  }

  const roleRes = detectRole(text);
  const role = roleRes.role;
  const roleRuleId = roleRes.ruleId;
  if (role !== 'unknown') {
    score += 2;
  }

  const level = detectLevel(text);
  if (level !== 'unknown') {
    score += 1;
  }

  const specialization = detectSpecialization(text);
  if (specialization.length > 0) {
    score += 1;
  }

  return { score, role, roleRuleId, level, specialization, warnings };
}

export function extractTitle(
  ctx: DocumentContext,
  opts: { strict: boolean; enableTraces: boolean },
): TitleExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const candidates = buildCandidates(ctx);
  if (candidates.length === 0) {
    warnings.push('title_not_found');
    return {
      title: { value: null, role: 'unknown', level: 'unknown', specialization: [], raw: null },
      confidence: 0,
      warnings,
      traces,
    };
  }

  const scored = candidates
    .map((c) => {
      const s = scoreCandidate(c);
      return { c, ...s };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  const confidence = scoreToConfidence(best.score, opts.strict);

  // Strict mode should still allow short, well-formed titles without strong role signals.
  const minConfidence = opts.strict ? 0.55 : 0.45;

  let value: string | null = cleanTitle(best.c.text);
  if (!looksLikeTitle(value)) {
    warnings.push('title_low_confidence');
    value = null;
  } else if (confidence < minConfidence) {
    // If it still looks like a title, keep it for UX, but surface low confidence.
    // This improves coverage on short non-IT roles (e.g. "Designer", "Account Executive").
    warnings.push('title_low_confidence');
  }

  if (best.warnings.length > 0) {
    warnings.push(...best.warnings);
  }

  const title: ParsedTitle = {
    value,
    role: best.role,
    level: best.level,
    specialization: best.specialization,
    raw: best.c.text,
  };

  if (opts.enableTraces) {
    for (const item of scored.slice(0, 5)) {
      traces.push({
        extractor: 'title',
        ruleId: `candidate:${item.c.source}`,
        section: item.c.section,
        snippet: item.c.text,
        scoreDelta: item.score,
      });
      if (item.roleRuleId) {
        traces.push({
          extractor: 'title',
          ruleId: item.roleRuleId,
          section: item.c.section,
          snippet: item.c.text,
          scoreDelta: 2,
        });
      }
    }
  }

  return { title, confidence, warnings, traces };
}

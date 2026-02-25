"use strict";var gt=Object.create;var $=Object.defineProperty;var Tt=Object.getOwnPropertyDescriptor;var ft=Object.getOwnPropertyNames;var ht=Object.getPrototypeOf,St=Object.prototype.hasOwnProperty;var bt=(n,e)=>{for(var t in e)$(n,t,{get:e[t],enumerable:!0})},ne=(n,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of ft(e))!St.call(n,r)&&r!==t&&$(n,r,{get:()=>e[r],enumerable:!(s=Tt(e,r))||s.enumerable});return n};var A=(n,e,t)=>(t=n!=null?gt(ht(n)):{},ne(e||!n||!n.__esModule?$(t,"default",{value:n,enumerable:!0}):t,n)),Ct=n=>ne($({},"__esModule",{value:!0}),n);var Ft={};bt(Ft,{generateContext:()=>re});module.exports=Ct(Ft);var mt=A(require("path"),1),_t=require("os"),Et=require("fs");var ge=require("bun:sqlite");var S=require("path"),pe=require("os"),ue=require("fs");var le=require("url");var R=require("fs"),w=require("path"),ae=require("os");var oe="bugfix,feature,refactor,discovery,decision,change",ie="how-it-works,why-it-exists,what-changed,problem-solution,gotcha,pattern,trade-off";var L=class{static DEFAULTS={CLAUDE_MEM_MODEL:"claude-sonnet-4-5",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_WORKER_PORT:"37777",CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-2.5-flash-lite",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"claude-mem",CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_OPENROUTER_MAX_TOKENS:"100000",CLAUDE_MEM_DATA_DIR:(0,w.join)((0,ae.homedir)(),".claude-mem"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"true",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"true",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"true",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES:oe,CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS:ie,CLAUDE_MEM_CONTEXT_FULL_COUNT:"5",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"10",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"false"};static getAllDefaults(){return{...this.DEFAULTS}}static get(e){return this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){return this.get(e)==="true"}static loadFromFile(e){try{if(!(0,R.existsSync)(e)){let i=this.getAllDefaults();try{let a=(0,w.dirname)(e);(0,R.existsSync)(a)||(0,R.mkdirSync)(a,{recursive:!0}),(0,R.writeFileSync)(e,JSON.stringify(i,null,2),"utf-8"),console.log("[SETTINGS] Created settings file with defaults:",e)}catch(a){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,a)}return i}let t=(0,R.readFileSync)(e,"utf-8"),s=JSON.parse(t),r=s;if(s.env&&typeof s.env=="object"){r=s.env;try{(0,R.writeFileSync)(e,JSON.stringify(r,null,2),"utf-8"),console.log("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(i){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,i)}}let o={...this.DEFAULTS};for(let i of Object.keys(this.DEFAULTS))r[i]!==void 0&&(o[i]=r[i]);return o}catch(t){return console.warn("[SETTINGS] Failed to load settings, using defaults:",e,t),this.getAllDefaults()}}};var I=require("fs"),v=require("path"),ce=require("os"),W=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(W||{}),de=(0,v.join)((0,ce.homedir)(),".claude-mem"),Y=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=(0,v.join)(de,"logs");(0,I.existsSync)(e)||(0,I.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,v.join)(e,`claude-mem-${t}.log`)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e),this.logFilePath=null}}}getLevel(){if(this.level===null)try{let e=(0,v.join)(de,"settings.json");if((0,I.existsSync)(e)){let t=(0,I.readFileSync)(e,"utf-8"),r=(JSON.parse(t).CLAUDE_MEM_LOG_LEVEL||"INFO").toUpperCase();this.level=W[r]??1}else this.level=1}catch{this.level=1}return this.level}correlationId(e,t){return`obs-${e}-${t}`}sessionId(e){return`session-${e}`}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),r=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${r} ${o}:${i}:${a}.${d}`}log(e,t,s,r,o){if(e<this.getLevel())return;this.ensureLogFileInitialized();let i=this.formatTimestamp(new Date),a=W[e].padEnd(5),d=t.padEnd(6),p="";r?.correlationId?p=`[${r.correlationId}] `:r?.sessionId&&(p=`[session-${r.sessionId}] `);let l="";o!=null&&(o instanceof Error?l=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`:this.getLevel()===0&&typeof o=="object"?l=`
`+JSON.stringify(o,null,2):l=" "+this.formatData(o));let m="";if(r){let{sessionId:g,memorySessionId:T,correlationId:b,..._}=r;Object.keys(_).length>0&&(m=` {${Object.entries(_).map(([f,O])=>`${f}=${O}`).join(", ")}}`)}let E=`[${i}] [${a}] [${d}] ${p}${s}${m}${l}`;if(this.logFilePath)try{(0,I.appendFileSync)(this.logFilePath,E+`
`,"utf8")}catch(g){process.stderr.write(`[LOGGER] Failed to write to log file: ${g}
`)}else process.stderr.write(E+`
`)}debug(e,t,s,r){this.log(0,e,t,s,r)}info(e,t,s,r){this.log(1,e,t,s,r)}warn(e,t,s,r){this.log(2,e,t,s,r)}error(e,t,s,r){this.log(3,e,t,s,r)}dataIn(e,t,s,r){this.info(e,`\u2192 ${t}`,s,r)}dataOut(e,t,s,r){this.info(e,`\u2190 ${t}`,s,r)}success(e,t,s,r){this.info(e,`\u2713 ${t}`,s,r)}failure(e,t,s,r){this.error(e,`\u2717 ${t}`,s,r)}timing(e,t,s,r){this.info(e,`\u23F1 ${t}`,r,{duration:`${s}ms`})}happyPathError(e,t,s,r,o=""){let p=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),l=p?`${p[1].split("/").pop()}:${p[2]}`:"unknown",m={...s,location:l};return this.warn(e,`[HAPPY-PATH] ${t}`,m,r),o}},u=new Y;var Rt={};function Ot(){return typeof __dirname<"u"?__dirname:(0,S.dirname)((0,le.fileURLToPath)(Rt.url))}var yt=Ot(),y=L.get("CLAUDE_MEM_DATA_DIR"),q=process.env.CLAUDE_CONFIG_DIR||(0,S.join)((0,pe.homedir)(),".claude"),Kt=(0,S.join)(y,"archives"),Jt=(0,S.join)(y,"logs"),Qt=(0,S.join)(y,"trash"),zt=(0,S.join)(y,"backups"),Zt=(0,S.join)(y,"modes"),es=(0,S.join)(y,"settings.json"),me=(0,S.join)(y,"claude-mem.db"),ts=(0,S.join)(y,"vector-db"),ss=(0,S.join)(y,"observer-sessions"),rs=(0,S.join)(q,"settings.json"),ns=(0,S.join)(q,"commands"),os=(0,S.join)(q,"CLAUDE.md");function _e(n){(0,ue.mkdirSync)(n,{recursive:!0})}function Ee(){return(0,S.join)(yt,"..")}var U=class{db;constructor(e=me){e!==":memory:"&&_e(y),this.db=new ge.Database(e),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn()}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);let e=this.db.prepare("SELECT version FROM schema_versions ORDER BY version").all();(e.length>0?Math.max(...e.map(s=>s.version)):0)===0&&(u.info("DB","Initializing fresh database with migration004"),this.db.run(`
        CREATE TABLE IF NOT EXISTS sdk_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content_session_id TEXT UNIQUE NOT NULL,
          memory_session_id TEXT UNIQUE,
          project TEXT NOT NULL,
          user_prompt TEXT,
          started_at TEXT NOT NULL,
          started_at_epoch INTEGER NOT NULL,
          completed_at TEXT,
          completed_at_epoch INTEGER,
          status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
        );

        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

        CREATE TABLE IF NOT EXISTS observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          text TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery')),
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
        CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
        CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
        CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

        CREATE TABLE IF NOT EXISTS session_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT UNIQUE NOT NULL,
          project TEXT NOT NULL,
          request TEXT,
          investigated TEXT,
          learned TEXT,
          completed TEXT,
          next_steps TEXT,
          files_read TEXT,
          files_edited TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
        CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
        CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
      `),this.db.prepare("INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString()),u.info("DB","Migration004 applied successfully"))}ensureWorkerPortColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(5))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(r=>r.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),u.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(6))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(d=>d.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),u.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(d=>d.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(d=>d.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(7))return;if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(r=>r.unique===1)){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}u.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),u.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(r=>r.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}u.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),u.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(r=>r.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}u.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change')),
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),u.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}u.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `),this.db.run(`
      CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
        prompt_text,
        content='user_prompts',
        content_rowid='id'
      );
    `),this.db.run(`
      CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;

      CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
      END;

      CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Successfully created user_prompts table with FTS5 support")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}u.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at_epoch INTEGER NOT NULL,
        started_processing_at_epoch INTEGER,
        completed_at_epoch INTEGER,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),u.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;u.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(r,o,i)=>{let a=this.db.query(`PRAGMA table_info(${r})`).all(),d=a.some(l=>l.name===o);return a.some(l=>l.name===i)?!1:d?(this.db.run(`ALTER TABLE ${r} RENAME COLUMN ${o} TO ${i}`),u.debug("DB",`Renamed ${r}.${o} to ${i}`),!0):(u.warn("DB",`Column ${o} not found in ${r}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?u.debug("DB",`Successfully renamed ${t} session ID columns`):u.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(r=>r.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),u.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}getRecentSummaries(e,t=10){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentSummariesWithSessionInfo(e,t=3){return this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentObservations(e,t=20){return this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getAllRecentObservations(e=100){return this.db.prepare(`
      SELECT id, type, title, subtitle, text, project, prompt_number, created_at, created_at_epoch
      FROM observations
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentSummaries(e=50){return this.db.prepare(`
      SELECT id, request, investigated, learned, completed, next_steps,
             files_read, files_edited, notes, project, prompt_number,
             created_at, created_at_epoch
      FROM session_summaries
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentUserPrompts(e=100){return this.db.prepare(`
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      LEFT JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      ORDER BY up.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllProjects(){return this.db.prepare(`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
      ORDER BY project ASC
    `).all().map(s=>s.project)}getLatestUserPrompt(e){return this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.content_session_id = ?
      ORDER BY up.created_at_epoch DESC
      LIMIT 1
    `).get(e)}getRecentSessionsWithStatus(e,t=3){return this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project = ? AND s.memory_session_id IS NOT NULL
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `).all(e,t)}getObservationsForSession(e){return this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch ASC
    `).all(e)}getObservationById(e){return this.db.prepare(`
      SELECT *
      FROM observations
      WHERE id = ?
    `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:r,project:o,type:i,concepts:a,files:d}=t,p=s==="date_asc"?"ASC":"DESC",l=r?`LIMIT ${r}`:"",m=e.map(()=>"?").join(","),E=[...e],g=[];if(o&&(g.push("project = ?"),E.push(o)),i)if(Array.isArray(i)){let _=i.map(()=>"?").join(",");g.push(`type IN (${_})`),E.push(...i)}else g.push("type = ?"),E.push(i);if(a){let _=Array.isArray(a)?a:[a],h=_.map(()=>"EXISTS (SELECT 1 FROM json_each(concepts) WHERE value = ?)");E.push(..._),g.push(`(${h.join(" OR ")})`)}if(d){let _=Array.isArray(d)?d:[d],h=_.map(()=>"(EXISTS (SELECT 1 FROM json_each(files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(files_modified) WHERE value LIKE ?))");_.forEach(f=>{E.push(`%${f}%`,`%${f}%`)}),g.push(`(${h.join(" OR ")})`)}let T=g.length>0?`WHERE id IN (${m}) AND ${g.join(" AND ")}`:`WHERE id IN (${m})`;return this.db.prepare(`
      SELECT *
      FROM observations
      ${T}
      ORDER BY created_at_epoch ${p}
      ${l}
    `).all(...E)}getSummaryForSession(e){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(e)||null}getFilesForSession(e){let s=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),r=new Set,o=new Set;for(let i of s){if(i.files_read){let a=JSON.parse(i.files_read);Array.isArray(a)&&a.forEach(d=>r.add(d))}if(i.files_modified){let a=JSON.parse(i.files_modified);Array.isArray(a)&&a.forEach(d=>o.add(d))}}return{filesRead:Array.from(r),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project, user_prompt
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getSdkSessionsBySessionIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project, user_prompt,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${t})
      ORDER BY started_at_epoch DESC
    `).all(...e)}getPromptNumberFromUserPrompts(e){return this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,t,s){let r=new Date,o=r.getTime();return this.db.prepare(`
      INSERT OR IGNORE INTO sdk_sessions
      (content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, 'active')
    `).run(e,t,s,r.toISOString(),o),this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e).id}saveUserPrompt(e,t,s){let r=new Date,o=r.getTime();return this.db.prepare(`
      INSERT INTO user_prompts
      (content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run(e,t,s,r.toISOString(),o).lastInsertRowid}getUserPrompt(e,t){return this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,r,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),l=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.type,s.title,s.subtitle,JSON.stringify(s.facts),s.narrative,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),r||null,o,d,a);return{id:Number(l.lastInsertRowid),createdAtEpoch:a}}storeSummary(e,t,s,r,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),l=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,s.request,s.investigated,s.learned,s.completed,s.next_steps,s.notes,r||null,o,d,a);return{id:Number(l.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,r,o,i=0,a){let d=a??Date.now(),p=new Date(d).toISOString();return this.db.transaction(()=>{let m=[],E=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let T of s){let b=E.run(e,t,T.type,T.title,T.subtitle,JSON.stringify(T.facts),T.narrative,JSON.stringify(T.concepts),JSON.stringify(T.files_read),JSON.stringify(T.files_modified),o||null,i,p,d);m.push(Number(b.lastInsertRowid))}let g=null;if(r){let b=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,r.request,r.investigated,r.learned,r.completed,r.next_steps,r.notes,o||null,i,p,d);g=Number(b.lastInsertRowid)}return{observationIds:m,summaryId:g,createdAtEpoch:d}})()}storeObservationsAndMarkComplete(e,t,s,r,o,i,a,d=0,p){let l=p??Date.now(),m=new Date(l).toISOString();return this.db.transaction(()=>{let g=[],T=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);for(let h of s){let f=T.run(e,t,h.type,h.title,h.subtitle,JSON.stringify(h.facts),h.narrative,JSON.stringify(h.concepts),JSON.stringify(h.files_read),JSON.stringify(h.files_modified),a||null,d,m,l);g.push(Number(f.lastInsertRowid))}let b;if(r){let f=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,r.request,r.investigated,r.learned,r.completed,r.next_steps,r.notes,a||null,d,m,l);b=Number(f.lastInsertRowid)}return this.db.prepare(`
        UPDATE pending_messages
        SET
          status = 'processed',
          completed_at_epoch = ?,
          tool_input = NULL,
          tool_response = NULL
        WHERE id = ? AND status = 'processing'
      `).run(l,o),{observationIds:g,summaryId:b,createdAtEpoch:l}})()}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:r,project:o}=t,i=s==="date_asc"?"ASC":"DESC",a=r?`LIMIT ${r}`:"",d=e.map(()=>"?").join(","),p=[...e],l=o?`WHERE id IN (${d}) AND project = ?`:`WHERE id IN (${d})`;return o&&p.push(o),this.db.prepare(`
      SELECT * FROM session_summaries
      ${l}
      ORDER BY created_at_epoch ${i}
      ${a}
    `).all(...p)}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:r,project:o}=t,i=s==="date_asc"?"ASC":"DESC",a=r?`LIMIT ${r}`:"",d=e.map(()=>"?").join(","),p=[...e],l=o?"AND s.project = ?":"";return o&&p.push(o),this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.id IN (${d}) ${l}
      ORDER BY up.created_at_epoch ${i}
      ${a}
    `).all(...p)}getTimelineAroundTimestamp(e,t=10,s=10,r){return this.getTimelineAroundObservation(null,e,t,s,r)}getTimelineAroundObservation(e,t,s=10,r=10,o){let i=o?"AND project = ?":"",a=o?[o]:[],d,p;if(e!==null){let _=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id <= ? ${i}
        ORDER BY id DESC
        LIMIT ?
      `,h=`
        SELECT id, created_at_epoch
        FROM observations
        WHERE id >= ? ${i}
        ORDER BY id ASC
        LIMIT ?
      `;try{let f=this.db.prepare(_).all(e,...a,s+1),O=this.db.prepare(h).all(e,...a,r+1);if(f.length===0&&O.length===0)return{observations:[],sessions:[],prompts:[]};d=f.length>0?f[f.length-1].created_at_epoch:t,p=O.length>0?O[O.length-1].created_at_epoch:t}catch(f){return u.error("DB","Error getting boundary observations",void 0,{error:f,project:o}),{observations:[],sessions:[],prompts:[]}}}else{let _=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch <= ? ${i}
        ORDER BY created_at_epoch DESC
        LIMIT ?
      `,h=`
        SELECT created_at_epoch
        FROM observations
        WHERE created_at_epoch >= ? ${i}
        ORDER BY created_at_epoch ASC
        LIMIT ?
      `;try{let f=this.db.prepare(_).all(t,...a,s),O=this.db.prepare(h).all(t,...a,r+1);if(f.length===0&&O.length===0)return{observations:[],sessions:[],prompts:[]};d=f.length>0?f[f.length-1].created_at_epoch:t,p=O.length>0?O[O.length-1].created_at_epoch:t}catch(f){return u.error("DB","Error getting boundary timestamps",void 0,{error:f,project:o}),{observations:[],sessions:[],prompts:[]}}}let l=`
      SELECT *
      FROM observations
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,m=`
      SELECT *
      FROM session_summaries
      WHERE created_at_epoch >= ? AND created_at_epoch <= ? ${i}
      ORDER BY created_at_epoch ASC
    `,E=`
      SELECT up.*, s.project, s.memory_session_id
      FROM user_prompts up
      JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${i.replace("project","s.project")}
      ORDER BY up.created_at_epoch ASC
    `,g=this.db.prepare(l).all(d,p,...a),T=this.db.prepare(m).all(d,p,...a),b=this.db.prepare(E).all(d,p,...a);return{observations:g,sessions:T.map(_=>({id:_.id,memory_session_id:_.memory_session_id,project:_.project,request:_.request,completed:_.completed,next_steps:_.next_steps,created_at:_.created_at,created_at_epoch:_.created_at_epoch})),prompts:b.map(_=>({id:_.id,content_session_id:_.content_session_id,prompt_number:_.prompt_number,prompt_text:_.prompt_text,project:_.project,created_at:_.created_at,created_at_epoch:_.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id = ?
      LIMIT 1
    `).get(e)||null}getPromptsByIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
      FROM user_prompts p
      LEFT JOIN sdk_sessions s ON p.content_session_id = s.content_session_id
      WHERE p.id IN (${t})
      ORDER BY p.created_at_epoch DESC
    `).all(...e)}getSessionSummaryById(e){return this.db.prepare(`
      SELECT
        id,
        memory_session_id,
        content_session_id,
        project,
        user_prompt,
        request_summary,
        learned_summary,
        status,
        created_at,
        created_at_epoch
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}close(){this.db.close()}importSdkSession(e){let t=this.db.prepare("SELECT id FROM sdk_sessions WHERE content_session_id = ?").get(e.content_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.memory_session_id,e.project,e.user_prompt,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}}importSessionSummary(e){let t=this.db.prepare("SELECT id FROM session_summaries WHERE memory_session_id = ?").get(e.memory_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.request,e.investigated,e.learned,e.completed,e.next_steps,e.files_read,e.files_edited,e.notes,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importObservation(e){let t=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(e.memory_session_id,e.title,e.created_at_epoch);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importUserPrompt(e){let t=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
    `).get(e.content_session_id,e.prompt_number);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}};var It="https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query",Nt="sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1",N=300*1e3,Lt=60*1e3,P=class{cache=new Map;async querySupabase(e){try{let t=await fetch(It,{method:"POST",headers:{Authorization:`Bearer ${Nt}`,"Content-Type":"application/json"},body:JSON.stringify({query:e})});if(!t.ok){let r=await t.text();throw new Error(`Supabase API error (${t.status}): ${r}`)}return await t.json()}catch(t){throw u.error("CONTENT","Supabase query failed",{sql:e.substring(0,100)},t),t}}async getCached(e,t,s){let r=this.cache.get(e);if(r&&Date.now()-r.timestamp<t)return r.data;let o=await s();return this.cache.set(e,{data:o,timestamp:Date.now()}),o}clearCache(){this.cache.clear()}async getScraperConfigs(){return this.getCached("scraper_configs",N,async()=>this.querySupabase(`SELECT id, name, status, config, last_run, items_collected, error_count, created_at
         FROM scraper_configs ORDER BY name`))}async getRSSFeedConfig(){return(await this.getScraperConfigs()).find(t=>t.id==="rss")||null}async getRecentContent(e=20,t){let s=`raw_content_${e}_${t||"all"}`;return this.getCached(s,N,async()=>{let r=t?`WHERE source_type = '${t}'`:"";return this.querySupabase(`SELECT id, source_type, raw_text, metadata, processing_status, word_count, content_hash, created_at, updated_at
         FROM raw_content ${r}
         ORDER BY created_at DESC LIMIT ${e}`)})}async searchContent(e,t=10){let s=e.replace(/'/g,"''");return this.querySupabase(`SELECT id, source_type, raw_text, metadata, processing_status, word_count, content_hash, created_at, updated_at
       FROM raw_content
       WHERE raw_text ILIKE '%${s}%'
          OR metadata->>'title' ILIKE '%${s}%'
          OR metadata->>'source' ILIKE '%${s}%'
       ORDER BY created_at DESC LIMIT ${t}`)}async getGoldenNuggets(e=20,t){let s=`nuggets_${e}_${t||"all"}`;return this.getCached(s,N,async()=>{let r=t?`WHERE pipeline_stage = '${t}'`:"";return this.querySupabase(`SELECT id, nugget_type, category, title, description, detailed_explanation,
                priority, pipeline_stage, status, created_at
         FROM golden_nuggets ${r}
         ORDER BY COALESCE(priority, 0) DESC, created_at DESC LIMIT ${e}`)})}async searchNuggets(e,t=10){let s=e.replace(/'/g,"''");return this.querySupabase(`SELECT id, nugget_type, category, title, description, detailed_explanation,
              priority, pipeline_stage, status, created_at
       FROM golden_nuggets
       WHERE title ILIKE '%${s}%'
          OR description ILIKE '%${s}%'
       ORDER BY COALESCE(priority, 0) DESC, created_at DESC LIMIT ${t}`)}async getContentQueue(e,t=20){let s=`queue_${e||"all"}_${t}`;return this.getCached(s,Lt,async()=>{let r=e?`WHERE status = '${e}'`:"";return this.querySupabase(`SELECT id, platform, content_type, title, body, status, scheduled_for, created_at
         FROM content_queue ${r}
         ORDER BY COALESCE(scheduled_for, created_at) ASC LIMIT ${t}`)})}async getContentLibrary(e=20){return this.getCached(`library_${e}`,N,async()=>this.querySupabase(`SELECT id, content_type, title, slug, content, description, status, created_at
         FROM content_library
         ORDER BY created_at DESC LIMIT ${e}`))}async getProcessedInsights(e=20){return this.getCached(`insights_${e}`,N,async()=>this.querySupabase(`SELECT id, raw_content_id, relevance_score, nugget_score, topic_tags,
                actionable_points, is_golden_nugget, created_at
         FROM processed_insights
         ORDER BY COALESCE(nugget_score, 0) DESC, created_at DESC LIMIT ${e}`))}async getPipelineStats(){return this.getCached("pipeline_stats",N,async()=>(await this.querySupabase(`SELECT
          (SELECT COUNT(*) FROM raw_content) as total_raw_content,
          (SELECT COUNT(*) FROM raw_content WHERE processing_status = 'processed') as total_processed,
          (SELECT COUNT(*) FROM golden_nuggets) as total_nuggets,
          (SELECT COUNT(*) FROM content_queue WHERE status = 'queued') as total_queued,
          (SELECT COUNT(*) FROM content_library) as total_library`))[0])}async getContentFeedSummary(){let[e,t,s,r,o]=await Promise.all([this.getScraperConfigs(),this.getRecentContent(10),this.getGoldenNuggets(10),this.getContentQueue("queued",10),this.getPipelineStats()]);return{scraper_configs:e,recent_content:t,golden_nuggets:s,content_queue:r,pipeline_stats:o}}async getExtractions(e=20){return this.getCached(`extractions_${e}`,N,async()=>this.querySupabase(`SELECT id, url, content_type, title, extracted_at, expires_at, error
         FROM extractions
         ORDER BY extracted_at DESC NULLS LAST LIMIT ${e}`))}async getCoreMemories(e=10){let t=`core_memories_${e}`;return this.getCached(t,N,async()=>this.querySupabase(`SELECT topic, content, memory_type, importance, tags
         FROM claude_memories
         WHERE is_archived = false
         ORDER BY importance DESC, created_at DESC
         LIMIT ${e}`))}async generateMemoryContext(){try{let e=await this.getCoreMemories(6);if(e.length===0)return"";let t=[];t.push("# Browning Memory \u2014 Persistent Context"),t.push("");for(let s of e)t.push(`## ${s.topic} [${s.memory_type}]`),t.push(s.content),t.push("");return t.join(`
`)}catch(e){return u.debug("CONTENT","Memory context loading skipped",{},e),""}}async generateContentDigest(){try{let[e,t,s]=await Promise.all([this.getGoldenNuggets(5),this.getContentQueue("queued",5),this.getPipelineStats()]),r=[];if(r.push("# Content Pipeline Status"),r.push(""),r.push("| Metric | Count |"),r.push("|--------|-------|"),r.push(`| Raw content | ${s.total_raw_content} |`),r.push(`| Processed | ${s.total_processed} |`),r.push(`| Golden nuggets | ${s.total_nuggets} |`),r.push(`| Queued posts | ${s.total_queued} |`),r.push(`| Library items | ${s.total_library} |`),e.length>0){r.push(""),r.push("## Top Golden Nuggets"),r.push(""),r.push("| Priority | Type | Title |"),r.push("|----------|------|-------|");for(let o of e)r.push(`| ${o.priority||"-"} | ${o.nugget_type} | ${o.title} |`)}if(t.length>0){r.push(""),r.push("## Upcoming Scheduled Posts"),r.push(""),r.push("| Platform | Title | Scheduled |"),r.push("|----------|-------|-----------|");for(let o of t){let i=o.scheduled_for?new Date(o.scheduled_for).toLocaleDateString():"unscheduled";r.push(`| ${o.platform} | ${o.title||o.body.substring(0,50)} | ${i} |`)}}return r.join(`
`)}catch(e){return u.error("CONTENT","Failed to generate content digest",{},e),`# Content Pipeline

_Unable to load content pipeline data._`}}};var Te=A(require("path"),1);function fe(n){if(!n||n.trim()==="")return u.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:n}),"unknown-project";let e=Te.default.basename(n);if(e===""){if(process.platform==="win32"){let s=n.match(/^([A-Z]):\\/i);if(s){let o=`drive-${s[1].toUpperCase()}`;return u.info("PROJECT_NAME","Drive root detected",{cwd:n,projectName:o}),o}}return u.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:n}),"unknown-project"}return e}var he=A(require("path"),1),Se=require("os");var D=require("fs"),F=require("path");var C=class n{static instance=null;activeMode=null;modesDir;constructor(){let e=Ee(),t=[(0,F.join)(e,"modes"),(0,F.join)(e,"..","plugin","modes")],s=t.find(r=>(0,D.existsSync)(r));this.modesDir=s||t[0]}static getInstance(){return n.instance||(n.instance=new n),n.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let r in t){let o=t[r],i=e[r];this.isPlainObject(o)&&this.isPlainObject(i)?s[r]=this.deepMerge(i,o):s[r]=o}return s}loadModeFile(e){let t=(0,F.join)(this.modesDir,`${e}.json`);if(!(0,D.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,D.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,u.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(p=>p.id),concepts:d.observation_concepts.map(p=>p.id)}),d}catch{if(u.warn("SYSTEM",`Mode file not found: ${e}, falling back to 'code'`),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:r}=t,o;try{o=this.loadMode(s)}catch{u.warn("SYSTEM",`Parent mode '${s}' not found for ${e}, falling back to 'code'`),o=this.loadMode("code")}let i;try{i=this.loadModeFile(r),u.debug("SYSTEM",`Loaded override file: ${r} for parent ${s}`)}catch{return u.warn("SYSTEM",`Override file '${r}' not found, using parent mode '${s}' only`),this.activeMode=o,o}if(!i)return u.warn("SYSTEM",`Invalid override file: ${r}, using parent mode '${s}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,u.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${r})`,void 0,{parent:s,override:r,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getObservationConcepts(){return this.getActiveMode().observation_concepts}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}validateType(e){return this.getObservationTypes().some(t=>t.id===e)}getTypeLabel(e){return this.getObservationTypes().find(s=>s.id===e)?.label||e}};function V(){let n=he.default.join((0,Se.homedir)(),".claude-mem","settings.json"),e=L.loadFromFile(n),t=e.CLAUDE_MEM_MODE,s=t==="code"||t.startsWith("code--"),r,o;if(s)r=new Set(e.CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES.split(",").map(i=>i.trim()).filter(Boolean)),o=new Set(e.CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS.split(",").map(i=>i.trim()).filter(Boolean));else{let i=C.getInstance().getActiveMode();r=new Set(i.observation_types.map(a=>a.id)),o=new Set(i.observation_concepts.map(a=>a.id))}return{totalObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.CLAUDE_MEM_CONTEXT_SESSION_COUNT,10),showReadTokens:e.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:r,observationConcepts:o,fullObservationField:e.CLAUDE_MEM_CONTEXT_FULL_FIELD,showLastSummary:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var c={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},be=4,K=1;function J(n){let e=(n.title?.length||0)+(n.subtitle?.length||0)+(n.narrative?.length||0)+JSON.stringify(n.facts||[]).length;return Math.ceil(e/be)}function Q(n){let e=n.length,t=n.reduce((i,a)=>i+J(a),0),s=n.reduce((i,a)=>i+(a.discovery_tokens||0),0),r=s-t,o=s>0?Math.round(r/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:r,savingsPercent:o}}function Mt(n){return C.getInstance().getWorkEmoji(n)}function M(n,e){let t=J(n),s=n.discovery_tokens||0,r=Mt(n.type),o=s>0?`${r} ${s.toLocaleString()}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:o,workEmoji:r}}function j(n){return n.showReadTokens||n.showWorkTokens||n.showSavingsAmount||n.showSavingsPercent}var Ce=A(require("path"),1),Oe=require("os"),X=require("fs");function z(n,e,t){let s=Array.from(t.observationTypes),r=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(",");return n.db.prepare(`
    SELECT
      id, memory_session_id, type, title, subtitle, narrative,
      facts, concepts, files_read, files_modified, discovery_tokens,
      created_at, created_at_epoch
    FROM observations
    WHERE project = ?
      AND type IN (${r})
      AND EXISTS (
        SELECT 1 FROM json_each(concepts)
        WHERE value IN (${i})
      )
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(e,...s,...o,t.totalObservationCount)}function Z(n,e,t){return n.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, created_at, created_at_epoch
    FROM session_summaries
    WHERE project = ?
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(e,t.sessionCount+K)}function ye(n,e,t){let s=Array.from(t.observationTypes),r=s.map(()=>"?").join(","),o=Array.from(t.observationConcepts),i=o.map(()=>"?").join(","),a=e.map(()=>"?").join(",");return n.db.prepare(`
    SELECT
      id, memory_session_id, type, title, subtitle, narrative,
      facts, concepts, files_read, files_modified, discovery_tokens,
      created_at, created_at_epoch, project
    FROM observations
    WHERE project IN (${a})
      AND type IN (${r})
      AND EXISTS (
        SELECT 1 FROM json_each(concepts)
        WHERE value IN (${i})
      )
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(...e,...s,...o,t.totalObservationCount)}function Re(n,e,t){let s=e.map(()=>"?").join(",");return n.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, created_at, created_at_epoch, project
    FROM session_summaries
    WHERE project IN (${s})
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(...e,t.sessionCount+K)}function At(n){return n.replace(/\//g,"-")}function vt(n){try{if(!(0,X.existsSync)(n))return{userMessage:"",assistantMessage:""};let e=(0,X.readFileSync)(n,"utf-8").trim();if(!e)return{userMessage:"",assistantMessage:""};let t=e.split(`
`).filter(r=>r.trim()),s="";for(let r=t.length-1;r>=0;r--)try{let o=t[r];if(!o.includes('"type":"assistant"'))continue;let i=JSON.parse(o);if(i.type==="assistant"&&i.message?.content&&Array.isArray(i.message.content)){let a="";for(let d of i.message.content)d.type==="text"&&(a+=d.text);if(a=a.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g,"").trim(),a){s=a;break}}}catch(o){u.debug("PARSER","Skipping malformed transcript line",{lineIndex:r},o);continue}return{userMessage:"",assistantMessage:s}}catch(e){return u.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:n},e),{userMessage:"",assistantMessage:""}}}function ee(n,e,t,s){if(!e.showLastMessage||n.length===0)return{userMessage:"",assistantMessage:""};let r=n.find(d=>d.memory_session_id!==t);if(!r)return{userMessage:"",assistantMessage:""};let o=r.memory_session_id,i=At(s),a=Ce.default.join((0,Oe.homedir)(),".claude","projects",i,`${o}.jsonl`);return vt(a)}function Ie(n,e){let t=e[0]?.id;return n.map((s,r)=>{let o=r===0?null:e[r+1];return{...s,displayEpoch:o?o.created_at_epoch:s.created_at_epoch,displayTime:o?o.created_at:s.created_at,shouldShowLink:s.id!==t}})}function te(n,e){let t=[...n.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,r)=>{let o=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,i=r.type==="observation"?r.data.created_at_epoch:r.data.displayEpoch;return o-i}),t}function Ne(n,e){return new Set(n.slice(0,e).map(t=>t.id))}function Le(){let n=new Date,e=n.toLocaleDateString("en-CA"),t=n.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=n.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function Me(n){return[`# [${n}] recent context, ${Le()}`,""]}function Ae(){return[`**Legend:** session-request | ${C.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ")}`,""]}function ve(){return["**Column Key**:","- **Read**: Tokens to read this observation (cost to learn it now)","- **Work**: Tokens spent on work that produced this record ( research, building, deciding)",""]}function De(){return["**Context Index:** This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.","","When you need implementation details, rationale, or debugging context:","- Use MCP tools (search, get_observations) to fetch full observations on-demand","- Critical types ( bugfix, decision) often need detailed fetching","- Trust this index over re-reading code for past decisions and learnings",""]}function xe(n,e){let t=[];if(t.push("**Context Economics**:"),t.push(`- Loading: ${n.totalObservations} observations (${n.totalReadTokens.toLocaleString()} tokens to read)`),t.push(`- Work investment: ${n.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions`),n.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="- Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${n.savings.toLocaleString()} tokens (${n.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${n.savings.toLocaleString()} tokens`:s+=`${n.savingsPercent}% reduction from reuse`,t.push(s)}return t.push(""),t}function ke(n){return[`### ${n}`,""]}function $e(n){return[`**${n}**`,"| ID | Time | T | Title | Read | Work |","|----|------|---|-------|------|------|"]}function we(n,e,t){let s=n.title||"Untitled",r=C.getInstance().getTypeIcon(n.type),{readTokens:o,discoveryDisplay:i}=M(n,t),a=t.showReadTokens?`~${o}`:"",d=t.showWorkTokens?i:"";return`| #${n.id} | ${e||'"'} | ${r} | ${s} | ${a} | ${d} |`}function Ue(n,e,t,s){let r=[],o=n.title||"Untitled",i=C.getInstance().getTypeIcon(n.type),{readTokens:a,discoveryDisplay:d}=M(n,s);r.push(`**#${n.id}** ${e||'"'} ${i} **${o}**`),t&&(r.push(""),r.push(t),r.push(""));let p=[];return s.showReadTokens&&p.push(`Read: ~${a}`),s.showWorkTokens&&p.push(`Work: ${d}`),p.length>0&&r.push(p.join(", ")),r.push(""),r}function Pe(n,e){let t=`${n.request||"Session started"} (${e})`;return[`**#S${n.id}** ${t}`,""]}function x(n,e){return e?[`**${n}**: ${e}`,""]:[]}function Fe(n){return n.assistantMessage?["","---","","**Previously**","",`A: ${n.assistantMessage}`,""]:[]}function je(n,e){return["",`Access ${Math.round(n/1e3)}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use MCP search tools to access memories by ID.`]}function Xe(n){return`# [${n}] recent context, ${Le()}

No previous sessions found for this project yet.`}function Be(){let n=new Date,e=n.toLocaleDateString("en-CA"),t=n.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=n.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function Ge(n){return["",`${c.bright}${c.cyan}[${n}] recent context, ${Be()}${c.reset}`,`${c.gray}${"\u2500".repeat(60)}${c.reset}`,""]}function He(){let e=C.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${c.dim}Legend: session-request | ${e}${c.reset}`,""]}function We(){return[`${c.bright}Column Key${c.reset}`,`${c.dim}  Read: Tokens to read this observation (cost to learn it now)${c.reset}`,`${c.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${c.reset}`,""]}function Ye(){return[`${c.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${c.reset}`,"",`${c.dim}When you need implementation details, rationale, or debugging context:${c.reset}`,`${c.dim}  - Use MCP tools (search, get_observations) to fetch full observations on-demand${c.reset}`,`${c.dim}  - Critical types ( bugfix, decision) often need detailed fetching${c.reset}`,`${c.dim}  - Trust this index over re-reading code for past decisions and learnings${c.reset}`,""]}function qe(n,e){let t=[];if(t.push(`${c.bright}${c.cyan}Context Economics${c.reset}`),t.push(`${c.dim}  Loading: ${n.totalObservations} observations (${n.totalReadTokens.toLocaleString()} tokens to read)${c.reset}`),t.push(`${c.dim}  Work investment: ${n.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${c.reset}`),n.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${n.savings.toLocaleString()} tokens (${n.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${n.savings.toLocaleString()} tokens`:s+=`${n.savingsPercent}% reduction from reuse`,t.push(`${c.green}${s}${c.reset}`)}return t.push(""),t}function Ve(n){return[`${c.bright}${c.cyan}${n}${c.reset}`,""]}function Ke(n){return[`${c.dim}${n}${c.reset}`]}function Je(n,e,t,s){let r=n.title||"Untitled",o=C.getInstance().getTypeIcon(n.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=M(n,s),p=t?`${c.dim}${e}${c.reset}`:" ".repeat(e.length),l=s.showReadTokens&&i>0?`${c.dim}(~${i}t)${c.reset}`:"",m=s.showWorkTokens&&a>0?`${c.dim}(${d} ${a.toLocaleString()}t)${c.reset}`:"";return`  ${c.dim}#${n.id}${c.reset}  ${p}  ${o}  ${r} ${l} ${m}`}function Qe(n,e,t,s,r){let o=[],i=n.title||"Untitled",a=C.getInstance().getTypeIcon(n.type),{readTokens:d,discoveryTokens:p,workEmoji:l}=M(n,r),m=t?`${c.dim}${e}${c.reset}`:" ".repeat(e.length),E=r.showReadTokens&&d>0?`${c.dim}(~${d}t)${c.reset}`:"",g=r.showWorkTokens&&p>0?`${c.dim}(${l} ${p.toLocaleString()}t)${c.reset}`:"";return o.push(`  ${c.dim}#${n.id}${c.reset}  ${m}  ${a}  ${c.bright}${i}${c.reset}`),s&&o.push(`    ${c.dim}${s}${c.reset}`),(E||g)&&o.push(`    ${E} ${g}`),o.push(""),o}function ze(n,e){let t=`${n.request||"Session started"} (${e})`;return[`${c.yellow}#S${n.id}${c.reset} ${t}`,""]}function k(n,e,t){return e?[`${t}${n}:${c.reset} ${e}`,""]:[]}function Ze(n){return n.assistantMessage?["","---","",`${c.bright}${c.magenta}Previously${c.reset}`,"",`${c.dim}A: ${n.assistantMessage}${c.reset}`,""]:[]}function et(n,e){let t=Math.round(n/1e3);return["",`${c.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use MCP search tools to access memories by ID.${c.reset}`]}function tt(n){return`
${c.bright}${c.cyan}[${n}] recent context, ${Be()}${c.reset}
${c.gray}${"\u2500".repeat(60)}${c.reset}

${c.dim}No previous sessions found for this project yet.${c.reset}
`}function st(n,e,t,s){let r=[];return s?r.push(...Ge(n)):r.push(...Me(n)),s?r.push(...He()):r.push(...Ae()),s?r.push(...We()):r.push(...ve()),s?r.push(...Ye()):r.push(...De()),j(t)&&(s?r.push(...qe(e,t)):r.push(...xe(e,t))),r}var se=A(require("path"),1);function H(n){if(!n)return[];try{let e=JSON.parse(n);return Array.isArray(e)?e:[]}catch(e){return u.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:n?.substring(0,50)},e),[]}}function nt(n){return new Date(n).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function ot(n){return new Date(n).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function it(n){return new Date(n).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function rt(n,e){return se.default.isAbsolute(n)?se.default.relative(e,n):n}function at(n,e,t){let s=H(n);if(s.length>0)return rt(s[0],e);if(t){let r=H(t);if(r.length>0)return rt(r[0],e)}return"General"}function Dt(n){let e=new Map;for(let s of n){let r=s.type==="observation"?s.data.created_at:s.data.displayTime,o=it(r);e.has(o)||e.set(o,[]),e.get(o).push(s)}let t=Array.from(e.entries()).sort((s,r)=>{let o=new Date(s[0]).getTime(),i=new Date(r[0]).getTime();return o-i});return new Map(t)}function xt(n,e){return e.fullObservationField==="narrative"?n.narrative:n.facts?H(n.facts).join(`
`):null}function kt(n,e,t,s,r,o){let i=[];o?i.push(...Ve(n)):i.push(...ke(n));let a=null,d="",p=!1;for(let l of e)if(l.type==="summary"){p&&(i.push(""),p=!1,a=null,d="");let m=l.data,E=nt(m.displayTime);o?i.push(...ze(m,E)):i.push(...Pe(m,E))}else{let m=l.data,E=at(m.files_modified,r,m.files_read),g=ot(m.created_at),T=g!==d,b=T?g:"";d=g;let _=t.has(m.id);if(E!==a&&(p&&i.push(""),o?i.push(...Ke(E)):i.push(...$e(E)),a=E,p=!0),_){let h=xt(m,s);o?i.push(...Qe(m,g,T,h,s)):(p&&!o&&(i.push(""),p=!1),i.push(...Ue(m,b,h,s)),a=null)}else o?i.push(Je(m,g,T,s)):i.push(we(m,b,s))}return p&&i.push(""),i}function dt(n,e,t,s,r){let o=[],i=Dt(n);for(let[a,d]of i)o.push(...kt(a,d,e,t,s,r));return o}function ct(n,e,t){return!(!n.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function pt(n,e){let t=[];return e?(t.push(...k("Investigated",n.investigated,c.blue)),t.push(...k("Learned",n.learned,c.yellow)),t.push(...k("Completed",n.completed,c.green)),t.push(...k("Next Steps",n.next_steps,c.magenta))):(t.push(...x("Investigated",n.investigated)),t.push(...x("Learned",n.learned)),t.push(...x("Completed",n.completed)),t.push(...x("Next Steps",n.next_steps))),t}function ut(n,e){return e?Ze(n):Fe(n)}function lt(n,e,t){return!j(e)||n.totalDiscoveryTokens<=0||n.savings<=0?[]:t?et(n.totalDiscoveryTokens,n.totalReadTokens):je(n.totalDiscoveryTokens,n.totalReadTokens)}var $t=mt.default.join((0,_t.homedir)(),".claude","plugins","marketplaces","thedotmack","plugin",".install-version");function wt(){try{return new U}catch(n){if(n.code==="ERR_DLOPEN_FAILED"){try{(0,Et.unlinkSync)($t)}catch(e){u.debug("SYSTEM","Marker file cleanup failed (may not exist)",{},e)}return u.error("SYSTEM","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw n}}function Ut(n,e){return e?tt(n):Xe(n)}function Pt(n,e,t,s,r,o,i){let a=[],d=Q(e);a.push(...st(n,d,s,i));let p=t.slice(0,s.sessionCount),l=Ie(p,t),m=te(e,l),E=Ne(e,s.fullObservationCount);a.push(...dt(m,E,s,r,i));let g=t[0],T=e[0];ct(s,g,T)&&a.push(...pt(g,i));let b=ee(e,s,o,r);return a.push(...ut(b,i)),a.push(...lt(d,s,i)),a.join(`
`).trimEnd()}async function re(n,e=!1){let t=V(),s=n?.cwd??process.cwd(),r=fe(s),o=n?.projects||[r],i=wt();if(!i)return"";try{let a=o.length>1?ye(i,o,t):z(i,r,t),d=o.length>1?Re(i,o,t):Z(i,r,t);if(a.length===0&&d.length===0)return Ut(r,e);let p=Pt(r,a,d,t,s,n?.session_id,e);try{let l=new P,m=await l.generateMemoryContext();m&&(p+=`

`+m);let E=await l.generateContentDigest();E&&!E.includes("Unable to load")&&(p+=`

`+E)}catch(l){u.debug("CONTEXT","Content pipeline enrichment skipped",{},l)}return p}finally{i.close()}}0&&(module.exports={generateContext});

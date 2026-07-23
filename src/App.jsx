import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const emojiPattern = /:([a-z0-9_]{2,32}):/g;
const tokenPattern = /:([a-z0-9_]{2,32}):|@([a-z0-9_]{1,40})/gi;
const unicodeEmoji = {
  skull: '💀', joy: '😂', sob: '😭', fire: '🔥', heart: '❤️', thumbs_up: '👍', thumbsup: '👍', thumbsdown: '👎', clap: '👏', pray: '🙏', eyes: '👀', rocket: '🚀', tada: '🎉', party: '🎉', wave: '👋', ok_hand: '👌', thinking: '🤔', scream: '😱', cool: '😎', smile: '😄', grin: '😁', angry: '😠', warning: '⚠️', check: '✅', x: '❌'
};
const unicodeEmojiRows = Object.entries(unicodeEmoji).map(([name, symbol]) => ({ name, symbol }));

function initials(name = '?') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function mentionKey(name = '') {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
}

function mentionsProfile(body = '', profile) {
  return Boolean(profile && [...body.matchAll(/@([a-z0-9_]{1,40})/gi)].some((match) => match[1].toLowerCase() === mentionKey(profile.display_name)));
}

function messageText(body, emojis, users = [], profile) {
  const parts = [];
  let lastIndex = 0;
  for (const match of body.matchAll(tokenPattern)) {
    parts.push(body.slice(lastIndex, match.index));
    if (match[1]) {
      const emoji = emojis.find((item) => item.name === match[1]);
      if (emoji) parts.push(<img className="emoji" src={emoji.image_url} alt={match[0]} title={match[0]} key={`${match.index}-${emoji.id}`} />);
      else parts.push(<span className="unicode-emoji" title={match[0]} key={match.index}>{unicodeEmoji[match[1]] || match[0]}</span>);
    } else if (match[2]) {
      const user = users.find((item) => mentionKey(item.display_name) === match[2].toLowerCase());
      const me = user?.id === profile?.id;
      parts.push(<span className={me ? 'mention me' : 'mention'} key={match.index}>@{user?.display_name || match[2]}</span>);
    }
    lastIndex = match.index + match[0].length;
  }
  parts.push(body.slice(lastIndex));
  return parts;
}

function emojiNode(name, emojis) {
  const custom = emojis.find((item) => item.name === name);
  if (custom) return <img className="emoji" src={custom.image_url} alt={`:${name}:`} title={`:${name}:`} />;
  return <span className="unicode-emoji">{unicodeEmoji[name] || `:${name}:`}</span>;
}

function emojiNamesIn(text = '') {
  return [...text.matchAll(emojiPattern)].map((match) => match[1]);
}

function time(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function shouldGroup(previous, item) {
  if (!previous || previous.user_id !== item.user_id) return false;
  return new Date(item.created_at) - new Date(previous.created_at) < 5 * 60 * 1000;
}

function Login({ status, onSignIn }) {
  return (
    <main className="login-screen">
      <div className="login-blob one"></div>
      <div className="login-blob two"></div>
      <section className="login-card">
        <p>HCHAT</p>
        <h1>Hack Club chat, minus the corporate beige.</h1>
        <span>Channels, DMs, emoji, threads, and Hack Club Auth.</span>
        <button onClick={onSignIn}>Sign in with Hack Club</button>
        {status && <small>{status}</small>}
      </section>
    </main>
  );
}

function TopBar({ profile, search, setSearch, onSearch, onAccount }) {
  return (
    <header className="topbar">
      <strong>HCHAT</strong>
      <form onSubmit={onSearch}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" />
      </form>
      <button className="account" onClick={onAccount}><span>{initials(profile?.display_name)}</span>{profile?.display_name || 'You'}</button>
    </header>
  );
}

function Sidebar({ channels, channelId, dms, dmId, unread, mentions, isStaff, onChannel, onDm, onAdmin }) {
  return (
    <aside className="sidebar">
      <div className="workspace">
        <strong>HCHAT</strong>
        <small>Hack Club</small>
      </div>
      <nav>
        <p>Channels</p>
        {channels.map((channel) => (
          <button className={channel.id === channelId && !dmId ? 'active' : ''} onClick={() => onChannel(channel.id)} key={channel.id}>
            <span># {channel.name}{channel.private ? ' private' : ''}</span>
            <em>{mentions[channel.id] ? <b className="ping-badge">@{mentions[channel.id]}</b> : null}{unread[channel.id] ? <b>{unread[channel.id]}</b> : null}</em>
          </button>
        ))}
      </nav>
      <nav>
        <p>Direct messages</p>
        {dms.map((dm) => (
          <button className={dm.id === dmId ? 'active' : ''} onClick={() => onDm(dm.id)} key={dm.id}>
            <span><i></i>{dm.dm_members?.map((member) => member.profiles?.display_name).filter(Boolean).join(', ') || 'DM'}</span>
          </button>
        ))}
      </nav>
      {isStaff && <button className="admin-button" onClick={onAdmin}>Admin</button>}
    </aside>
  );
}

function ChannelHeader({ dmId, channel, status, onDrawer }) {
  return (
    <section className="channel-header">
      <div>
        <h2>{dmId ? 'Direct message' : `# ${channel?.name || 'channel'}`}</h2>
        <p>{dmId ? 'Private conversation' : channel?.topic || 'No topic set'}</p>
      </div>
      <div className="header-actions">
        {status && <span>{status}</span>}
        <button onClick={() => onDrawer('search')}>Find</button>
        <button onClick={() => onDrawer('people')}>Members</button>
        <button onClick={() => onDrawer('emoji')}>Emoji</button>
        <button onClick={() => onDrawer('details')}>Info</button>
      </div>
    </section>
  );
}

function EmojiChooser({ emojis, onPick }) {
  return (
    <div className="emoji-chooser">
      {[...unicodeEmojiRows, ...emojis.slice(0, 80)].map((emoji) => (
        <button onClick={() => onPick(emoji.name)} title={`:${emoji.name}:`} key={emoji.name}>
          {'symbol' in emoji ? <span>{emoji.symbol}</span> : <img src={emoji.image_url} alt={`:${emoji.name}:`} />}
        </button>
      ))}
    </div>
  );
}

function MessageRow({ item, previous, emojis, users, profile, isStaff, session, editingId, editingBody, setEditingBody, reactingTo, setReactingTo, onEditStart, onEditSave, onEditCancel, onDelete, onPin, onThread, onReact }) {
  const grouped = shouldGroup(previous, item);
  const name = item.profiles?.display_name || 'unknown';
  return (
    <article className={`message ${grouped ? 'grouped' : ''}`}>
      <div className="avatar">{grouped ? '' : initials(name)}</div>
      <div className="message-body">
        {!grouped && <div className="message-meta"><strong>{name}</strong><small>{time(item.created_at)}</small>{item.pinned && <em>pinned</em>}{item.edited_at && <em>edited</em>}</div>}
        <div className="message-tools">
          <button onClick={() => setReactingTo(reactingTo === item.id ? null : item.id)}>React</button>
          {isStaff && <button onClick={() => onPin(item)}>{item.pinned ? 'Unpin' : 'Pin'}</button>}
          <button onClick={() => onThread(item)}>Thread</button>
          {item.user_id === session.user.id && <button onClick={() => onEditStart(item)}>Edit</button>}
          {(item.user_id === session.user.id || isStaff) && <button className="danger-text" onClick={() => onDelete(item.id)}>Delete</button>}
        </div>
        {reactingTo === item.id && <EmojiChooser emojis={emojis} onPick={(name) => { onReact(item, name); setReactingTo(null); }} />}
        {editingId === item.id ? (
          <form className="edit-form" onSubmit={onEditSave}>
            <input value={editingBody} onChange={(event) => setEditingBody(event.target.value)} maxLength="2000" />
            <button>Save</button>
            <button type="button" onClick={onEditCancel}>Cancel</button>
          </form>
        ) : <p>{messageText(item.body, emojis, users, profile)}</p>}
        {item.attachment_url && <a className="attachment" href={item.attachment_url} target="_blank" rel="noreferrer">{item.attachment_name || 'attachment'}</a>}
        <div className="reactions">
          {Object.entries((item.reactions || []).reduce((acc, reaction) => ({ ...acc, [reaction.emoji_name]: (acc[reaction.emoji_name] || 0) + 1 }), {})).map(([name, count]) => (
            <button onClick={() => onReact(item, name)} key={name}>{emojiNode(name, emojis)} {count}</button>
          ))}
        </div>
      </div>
    </article>
  );
}

function MessageList(props) {
  const { dmId, dmMessages, messages, threadParent, emojis, setThreadParent, sendThreadMessage, threadMessage, setThreadMessage } = props;
  if (dmId) {
    if (!dmMessages.length) return <div className="empty-state">No messages here yet. Say hi.</div>;
    return <div className="message-list">{dmMessages.map((item, index) => <MessageRow {...props} item={item} previous={dmMessages[index - 1]} key={item.id} />)}</div>;
  }
  if (threadParent) {
    return (
      <div className="thread-view">
        <button onClick={() => setThreadParent(null)}>Close thread</button>
        <MessageRow {...props} item={threadParent} previous={null} />
        {(threadParent.replies || []).map((reply, index) => <MessageRow {...props} item={reply} previous={(threadParent.replies || [])[index - 1]} key={reply.id} />)}
        <form className="thread-composer" onSubmit={sendThreadMessage}>
          <input value={threadMessage} onChange={(event) => setThreadMessage(event.target.value)} placeholder="Reply in thread" maxLength="2000" />
          <button>Reply</button>
        </form>
      </div>
    );
  }
  if (!messages.length) return <div className="empty-state">This channel is brand new. First post gets bragging rights.</div>;
  return <div className="message-list">{messages.map((item, index) => <MessageRow {...props} item={item} previous={messages[index - 1]} key={item.id} />)}</div>;
}

function Composer({ dmId, value, setValue, onSubmit, onFile, channel, emojis, users }) {
  const [selected, setSelected] = useState(0);
  const [remoteEmojis, setRemoteEmojis] = useState([]);
  const match = value.match(/:([a-z0-9_]{1,32})$/i);
  const query = match?.[1]?.toLowerCase();
  const mentionMatch = value.match(/@([a-z0-9_]{1,40})$/i);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase();
  useEffect(() => {
    if (!query || query.length < 2 || !supabase) {
      setRemoteEmojis([]);
      return;
    }
    let cancelled = false;
    supabase.from('emojis').select('*').ilike('name', `${query}%`).order('name').limit(8).then(({ data }) => {
      if (!cancelled) setRemoteEmojis(data || []);
    });
    return () => { cancelled = true; };
  }, [query]);

  const emojiSuggestions = [...unicodeEmojiRows, ...emojis, ...remoteEmojis]
    .filter((emoji, index, all) => emoji.name.startsWith(query || '') && all.findIndex((item) => item.name === emoji.name) === index)
    .slice(0, 8);
  const suggestions = query
    ? emojiSuggestions
    : mentionQuery
    ? users.filter((user) => mentionKey(user.display_name).startsWith(mentionQuery)).slice(0, 8)
    : [];
  useEffect(() => setSelected(0), [query, mentionQuery]);
  function completeEmoji(name) {
    setValue(value.replace(query ? /:([a-z0-9_]{1,32})$/i : /@([a-z0-9_]{1,40})$/i, query ? `:${name}:` : `@${name} `));
  }
  function handleKeyDown(event) {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      completeEmoji(query ? suggestions[selected].name : mentionKey(suggestions[selected].display_name));
    } else if (event.key === 'Escape') {
      setSelected(0);
    }
  }
  return (
    <div className="composer-wrap">
      {suggestions.length > 0 && (
        <div className="autocomplete">
          {suggestions.map((item, index) => <button className={index === selected ? 'active' : ''} type="button" onMouseEnter={() => setSelected(index)} onClick={() => completeEmoji(query ? item.name : mentionKey(item.display_name))} key={query ? item.name : item.id}>{query ? emojiNode(item.name, emojis) : <span className="mini-avatar">{initials(item.display_name)}</span>} {query ? `:${item.name}:` : `@${item.display_name}`}</button>)}
        </div>
      )}
      <form className="composer" onSubmit={onSubmit}>
        <div className="composer-toolbar"><b>{dmId ? 'DM' : `#${channel?.name || 'channel'}`}</b><span>Type :skull: or :party_blob:</span></div>
        <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={handleKeyDown} placeholder={dmId ? 'Message this person' : `Message #${channel?.name || 'channel'}`} maxLength="2000" />
        {!dmId && <label><input type="file" onChange={(event) => onFile(event.target.files[0])} />Attach</label>}
        <button>Send</button>
      </form>
    </div>
  );
}

function Drawer(props) {
  const { mode, close, currentChannel, dmId, search, setSearch, runSearch, searchResults, setChannelId, emojis, setMessage, uploadEmoji, emojiName, setEmojiName, setEmojiFile, deleteEmoji, isStaff, users, startDm, setModeration, channelMembers, toggleChannelMember, auditLogs, createChannel, newChannel, setNewChannel, newTopic, setNewTopic, newPrivate, setNewPrivate, saveTopic, topic, setTopic, session, profile, profileName, setProfileName, saveProfile, signOut } = props;
  if (!mode) return null;
  return (
    <aside className="drawer">
      <header><strong>{mode === 'details' ? 'Channel details' : mode[0].toUpperCase() + mode.slice(1)}</strong><button onClick={close}>x</button></header>
      {mode === 'details' && <div className="card"><h3>{dmId ? 'Direct message' : `# ${currentChannel?.name || 'channel'}`}</h3><p>{dmId ? 'Private conversation' : currentChannel?.topic || 'No topic yet'}</p></div>}
      {mode === 'profile' && <><div className="profile-card"><span>{initials(profile?.display_name)}</span><strong>{profile?.display_name}</strong><small>{profile?.email || 'Hack Club Auth'}</small></div><form className="stack" onSubmit={saveProfile}><input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Display name" maxLength="40" /><button>Save name</button></form><button className="signout" onClick={signOut}>Sign out</button></>}
      {mode === 'search' && <><form className="stack" onSubmit={runSearch}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="find messages" /><button>Search</button></form><div className="result-list">{searchResults.map((item) => <button onClick={() => setChannelId(item.channel_id)} key={item.id}><small>#{item.channels?.name} - {item.profiles?.display_name}</small><span>{item.body}</span></button>)}</div></>}
      {mode === 'emoji' && <><div className="emoji-grid">{emojis.map((emoji) => <button onClick={() => setMessage((current) => `${current} :${emoji.name}:`.trimStart())} key={emoji.id}><img src={emoji.image_url} alt={`:${emoji.name}:`} />{(emoji.created_by === session.user.id || isStaff) && <span onClick={(event) => { event.stopPropagation(); deleteEmoji(emoji); }}>x</span>}</button>)}</div><form className="stack" onSubmit={uploadEmoji}><input value={emojiName} onChange={(event) => setEmojiName(event.target.value)} placeholder="party_blob" /><input type="file" accept="image/png,image/webp,image/gif" onChange={(event) => setEmojiFile(event.target.files[0])} /><button>Upload emoji</button></form></>}
      {mode === 'people' && <div className="people-list">{users.map((user) => <article key={user.id}><strong><i></i>{user.display_name}</strong><small>{user.email ? `${user.email} - ` : ''}{user.role}</small><button onClick={() => startDm(user)}>DM</button></article>)}</div>}
      {mode === 'admin' && isStaff && <><form className="stack" onSubmit={createChannel}><input value={newChannel} onChange={(event) => setNewChannel(event.target.value)} placeholder="new channel" /><input value={newTopic} onChange={(event) => setNewTopic(event.target.value)} placeholder="what's it for?" /><label><input type="checkbox" checked={newPrivate} onChange={(event) => setNewPrivate(event.target.checked)} /> Private</label><button>Create channel</button></form>{currentChannel && <form className="stack" onSubmit={saveTopic}><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="channel topic" /><button>Save topic</button></form>}<h3>Moderation</h3><div className="people-list">{users.map((user) => <article key={user.id}><strong>{user.display_name}</strong><small>{user.moderation?.banned ? 'banned' : user.moderation?.timeout_until ? `timeout until ${new Date(user.moderation.timeout_until).toLocaleString()}` : 'clear'}</small><div><button onClick={() => setModeration(user, { banned: false, timeout_until: null, reason: '' })}>Clear</button><button onClick={() => setModeration(user, { banned: false, timeout_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: '1h timeout' })}>1h</button><button onClick={() => setModeration(user, { banned: true, timeout_until: null, reason: 'banned' })}>Ban</button></div>{currentChannel?.private && <button onClick={() => toggleChannelMember(user)}>{channelMembers.includes(user.id) ? 'Remove from private' : 'Add to private'}</button>}</article>)}</div><h3>Audit</h3><div className="result-list">{auditLogs.map((log) => <button key={log.id}><small>{new Date(log.created_at).toLocaleString()} - {log.profiles?.display_name || 'system'}</small><span>{log.action}: {log.target}</span></button>)}</div></>}
    </aside>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState({});
  const [mentions, setMentions] = useState({});
  const [threadParent, setThreadParent] = useState(null);
  const [emojis, setEmojis] = useState([]);
  const [users, setUsers] = useState([]);
  const [channelMembers, setChannelMembers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [dms, setDms] = useState([]);
  const [dmId, setDmId] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState('');
  const [threadMessage, setThreadMessage] = useState('');
  const [dmMessage, setDmMessage] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [reactingTo, setReactingTo] = useState(null);
  const [newChannel, setNewChannel] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [newPrivate, setNewPrivate] = useState(false);
  const [topic, setTopic] = useState('');
  const [emojiName, setEmojiName] = useState('');
  const [emojiFile, setEmojiFile] = useState(null);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [status, setStatus] = useState(supabase ? '' : 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');

  const isStaff = profile?.role === 'mod' || profile?.role === 'admin';
  const currentChannel = channels.find((channel) => channel.id === channelId);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: auth } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => auth.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    Promise.all([getOrCreateProfile(), supabase.from('channels').select('*').order('created_at'), supabase.from('emojis').select('*').order('name').limit(300)]).then(([profileResult, channelResult, emojiResult]) => {
      if (profileResult.error || channelResult.error || emojiResult.error) return setStatus(profileResult.error?.message || channelResult.error?.message || emojiResult.error?.message);
      setProfile(profileResult.data);
      setProfileName(profileResult.data.display_name || '');
      setChannels(channelResult.data);
      setChannelId((current) => current || channelResult.data[0]?.id || null);
      setEmojis(emojiResult.data);
      reloadUsers(profileResult.data.role);
      reloadAudit(profileResult.data.role);
      reloadDms();
      reloadUnread(channelResult.data, profileResult.data);
    });
    const room = supabase.channel('global').on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => reloadChannels()).on('postgres_changes', { event: '*', schema: 'public', table: 'emojis' }, () => reloadEmojis()).subscribe();
    return () => supabase.removeChannel(room);
  }, [session]);

  useEffect(() => {
    if (!supabase || !channelId) return;
    setTopic(channels.find((channel) => channel.id === channelId)?.topic || '');
    loadMessages();
    reloadChannelMembers();
    const room = supabase.channel(`messages:${channelId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` }, () => loadMessages()).on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => loadMessages()).subscribe();
    return () => supabase.removeChannel(room);
  }, [channelId, channels]);

  useEffect(() => {
    if (!supabase || !dmId) return;
    loadDmMessages();
    const room = supabase.channel(`dm:${dmId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${dmId}` }, () => loadDmMessages()).subscribe();
    return () => supabase.removeChannel(room);
  }, [dmId]);

  async function getOrCreateProfile() {
    const existing = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (existing.data || existing.error) return existing;
    const fallbackName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'hackclubber';
    return supabase.from('profiles').upsert({ id: session.user.id, email: session.user.email, display_name: fallbackName, approved: true }).select('*').single();
  }
  async function reloadChannels() { const { data, error } = await supabase.from('channels').select('*').order('created_at'); if (error) setStatus(error.message); else setChannels(data); }
  async function reloadEmojis() { const { data, error } = await supabase.from('emojis').select('*').order('name').limit(300); if (error) setStatus(error.message); else setEmojis(data); }
  async function loadEmojiNames(names) { const missing = [...new Set(names)].filter((name) => !unicodeEmoji[name] && !emojis.some((emoji) => emoji.name === name)); if (!missing.length) return; const { data, error } = await supabase.from('emojis').select('*').in('name', missing); if (!error && data?.length) setEmojis((current) => [...current, ...data.filter((item) => !current.some((emoji) => emoji.name === item.name))]); }
  async function reloadUsers(role = profile?.role) { const staff = role === 'mod' || role === 'admin'; const { data, error } = await supabase.from('profiles').select(staff ? 'id, email, display_name, role, moderation!moderation_user_id_fkey(banned, timeout_until, reason)' : 'id, display_name, role').eq('approved', true).order('display_name'); if (error) setStatus(error.message); else setUsers(data); }
  async function reloadAudit(role = profile?.role) { if (role !== 'mod' && role !== 'admin') return; const { data, error } = await supabase.from('audit_logs').select('*, profiles!audit_logs_actor_id_fkey(display_name)').order('created_at', { ascending: false }).limit(50); if (error) setStatus(error.message); else setAuditLogs(data); }
  async function reloadChannelMembers() { if (!channelId) return; const { data } = await supabase.from('channel_members').select('user_id').eq('channel_id', channelId); setChannelMembers((data || []).map((item) => item.user_id)); }
  async function reloadUnread(channelRows = channels, currentProfile = profile) { const pairs = await Promise.all(channelRows.map(async (channel) => { const receipt = await supabase.from('read_receipts').select('last_read_at').eq('channel_id', channel.id).maybeSingle(); const since = receipt.data?.last_read_at || '1970-01-01T00:00:00Z'; const count = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', channel.id).gt('created_at', since).is('parent_id', null); const mentionRows = await supabase.from('messages').select('body').eq('channel_id', channel.id).gt('created_at', since).is('parent_id', null).limit(100); return [channel.id, count.count || 0, (mentionRows.data || []).filter((item) => mentionsProfile(item.body, currentProfile)).length]; })); setUnread(Object.fromEntries(pairs.map(([id, count]) => [id, count]))); setMentions(Object.fromEntries(pairs.map(([id, , mentionCount]) => [id, mentionCount]))); }
  async function reloadDms() { const { data, error } = await supabase.from('dm_conversations').select('id, created_at, dm_members!dm_members_conversation_id_fkey(profiles!dm_members_user_id_fkey(id, display_name))').order('created_at', { ascending: false }); if (error) setStatus(error.message); else setDms(data); }
  async function loadMessages() { const { data, error } = await supabase.from('messages').select('id, body, attachment_url, attachment_name, attachment_type, pinned, edited_at, created_at, user_id, profiles!messages_user_id_fkey(display_name, role), reactions(emoji_name, user_id)').eq('channel_id', channelId).is('parent_id', null).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(120); if (error) setStatus(error.message); else { await loadEmojiNames(data.flatMap((item) => [...emojiNamesIn(item.body), ...(item.reactions || []).map((reaction) => reaction.emoji_name)])); setMessages(data.reverse()); await supabase.from('read_receipts').upsert({ channel_id: channelId, last_read_at: new Date().toISOString() }); setUnread((current) => ({ ...current, [channelId]: 0 })); setMentions((current) => ({ ...current, [channelId]: 0 })); } }
  async function loadDmMessages() { const { data, error } = await supabase.from('dm_messages').select('id, body, created_at, user_id, profiles!dm_messages_user_id_fkey(display_name)').eq('conversation_id', dmId).order('created_at').limit(120); if (error) setStatus(error.message); else setDmMessages(data); }
  async function signIn(event) { event.preventDefault(); setStatus('Opening Hack Club Auth...'); const { error } = await supabase.auth.signInWithOAuth({ provider: 'custom:hca', options: { redirectTo: location.origin + import.meta.env.BASE_URL } }); if (error) setStatus(error.message); }
  async function saveProfile(event) { event.preventDefault(); const name = profileName.trim(); if (name.length < 2) return setStatus('Display name too short.'); const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', session.user.id); if (error) setStatus(error.message); else { setProfile((current) => ({ ...current, display_name: name })); setProfileName(name); setStatus('Profile saved.'); reloadUsers(profile?.role); } }
  async function uploadAttachment() { if (!attachmentFile) return {}; if (attachmentFile.size > 10 * 1024 * 1024) return { error: { message: 'Attachment max size is 10MB.' } }; const safeName = attachmentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_'); const path = `${crypto.randomUUID()}-${safeName}`; const upload = await supabase.storage.from('attachments').upload(path, attachmentFile); if (upload.error) return { error: upload.error }; const { data } = supabase.storage.from('attachments').getPublicUrl(path); setAttachmentFile(null); return { attachment_url: data.publicUrl, attachment_name: attachmentFile.name, attachment_type: attachmentFile.type }; }
  async function sendMessage(event) { event.preventDefault(); const body = message.trim(); if (!body || !channelId) return; setMessage(''); const attachment = await uploadAttachment(); if (attachment.error) return setStatus(attachment.error.message); const { data, error } = await supabase.from('messages').insert({ channel_id: channelId, body, ...attachment }).select('id, body, attachment_url, attachment_name, attachment_type, pinned, edited_at, created_at, user_id').single(); if (error) { setMessage(body); setStatus(error.message); } else setMessages((current) => [...current, { ...data, profiles: { display_name: profile?.display_name, role: profile?.role }, reactions: [] }]); }
  async function sendThreadMessage(event) { event.preventDefault(); const body = threadMessage.trim(); if (!body || !threadParent) return; setThreadMessage(''); const { data, error } = await supabase.from('messages').insert({ channel_id: channelId, parent_id: threadParent.id, body }).select('id, body, created_at, user_id').single(); if (error) { setThreadMessage(body); setStatus(error.message); } else setThreadParent((current) => ({ ...current, replies: [...(current.replies || []), { ...data, profiles: { display_name: profile?.display_name } }] })); }
  async function sendDm(event) { event.preventDefault(); const body = dmMessage.trim(); if (!body || !dmId) return; setDmMessage(''); const { data, error } = await supabase.from('dm_messages').insert({ conversation_id: dmId, body }).select('id, body, created_at, user_id').single(); if (error) { setDmMessage(body); setStatus(error.message); } else setDmMessages((current) => [...current, { ...data, profiles: { display_name: profile?.display_name } }]); }
  async function loadThread(parent) { const { data, error } = await supabase.from('messages').select('id, body, created_at, user_id, profiles!messages_user_id_fkey(display_name)').eq('parent_id', parent.id).order('created_at'); if (error) setStatus(error.message); else { setThreadParent({ ...parent, replies: data }); setDrawer(null); } }
  async function deleteMessage(id) { const { error } = await supabase.from('messages').delete().eq('id', id); if (error) setStatus(error.message); else { setMessages((current) => current.filter((item) => item.id !== id)); setThreadParent((current) => current ? { ...current, replies: (current.replies || []).filter((item) => item.id !== id) } : current); } }
  async function saveEdit(event) { event.preventDefault(); const body = editingBody.trim(); if (!body || !editingId) return; const { data, error } = await supabase.rpc('edit_message', { message_id: editingId, new_body: body }); if (error) setStatus(error.message); else if (!data) setStatus('Cannot edit this message.'); else { setEditingId(null); setEditingBody(''); loadMessages(); } }
  async function togglePin(item) { const { error } = await supabase.from('messages').update({ pinned: !item.pinned }).eq('id', item.id); if (error) setStatus(error.message); }
  async function react(item, emojiName) { const exists = item.reactions?.some((reaction) => reaction.user_id === session.user.id && reaction.emoji_name === emojiName); const request = exists ? supabase.from('reactions').delete().eq('message_id', item.id).eq('emoji_name', emojiName) : supabase.from('reactions').insert({ message_id: item.id, emoji_name: emojiName }); const { error } = await request; if (error) setStatus(error.message); }
  async function createChannel(event) { event.preventDefault(); const name = newChannel.trim().toLowerCase(); if (!/^[a-z0-9_-]{2,32}$/.test(name)) return setStatus('Channel name must be 2-32 chars: a-z, 0-9, underscore, dash.'); const { error } = await supabase.from('channels').insert({ name, topic: newTopic.trim(), private: newPrivate }); if (error) setStatus(error.message); else { setNewChannel(''); setNewTopic(''); setNewPrivate(false); audit('channel.create', name); } }
  async function saveTopic(event) { event.preventDefault(); const { error } = await supabase.from('channels').update({ topic: topic.trim() }).eq('id', channelId); if (error) setStatus(error.message); else audit('channel.topic', currentChannel?.name || channelId); }
  async function setModeration(user, patch) { const { error } = await supabase.from('moderation').upsert({ user_id: user.id, updated_by: session.user.id, ...patch }); if (error) setStatus(error.message); else { reloadUsers(); audit('moderation.update', user.display_name); } }
  async function audit(action, target) { await supabase.from('audit_logs').insert({ action, target: String(target || '') }); reloadAudit(); }
  async function toggleChannelMember(user) { const exists = channelMembers.includes(user.id); const request = exists ? supabase.from('channel_members').delete().eq('channel_id', channelId).eq('user_id', user.id) : supabase.from('channel_members').insert({ channel_id: channelId, user_id: user.id }); const { error } = await request; if (error) setStatus(error.message); else { reloadChannelMembers(); audit(exists ? 'channel.member.remove' : 'channel.member.add', user.display_name); } }
  async function startDm(user) { const { data, error } = await supabase.rpc('create_dm', { other_user_id: user.id }); if (error) setStatus(error.message); else { setDmId(data); setDrawer(null); reloadDms(); } }
  async function runSearch(event) { event.preventDefault(); const query = search.trim(); if (!query) return setSearchResults([]); const { data, error } = await supabase.from('messages').select('id, body, created_at, channel_id, channels!messages_channel_id_fkey(name), profiles!messages_user_id_fkey(display_name)').ilike('body', `%${query}%`).order('created_at', { ascending: false }).limit(25); if (error) setStatus(error.message); else { setSearchResults(data); setDrawer('search'); } }
  async function uploadEmoji(event) { event.preventDefault(); const name = emojiName.trim().toLowerCase(); if (!/^[a-z0-9_]{2,32}$/.test(name) || !emojiFile) return setStatus('Emoji name must be 2-32 chars: a-z, 0-9, underscore.'); if (emojiFile.size > 1024 * 1024) return setStatus('Emoji max size is 1MB.'); const extension = emojiFile.name.split('.').pop()?.toLowerCase() || 'png'; const path = `${crypto.randomUUID()}.${extension}`; const upload = await supabase.storage.from('emojis').upload(path, emojiFile, { cacheControl: '31536000' }); if (upload.error) return setStatus(upload.error.message); const { data } = supabase.storage.from('emojis').getPublicUrl(path); const insert = await supabase.from('emojis').insert({ name, image_url: data.publicUrl }).select().single(); if (insert.error) setStatus(insert.error.message); else { setEmojis((current) => [...current, insert.data].sort((a, b) => a.name.localeCompare(b.name))); setEmojiName(''); setEmojiFile(null); event.currentTarget.reset(); } }
  async function deleteEmoji(emoji) { const { error } = await supabase.from('emojis').delete().eq('id', emoji.id); if (error) setStatus(error.message); }

  if (!supabase) return <main className="login-screen">{status}</main>;
  if (!session) return <Login status={status} onSignIn={signIn} />;

  return (
    <main className="shell">
      <TopBar profile={profile} search={search} setSearch={setSearch} onSearch={runSearch} onAccount={() => setDrawer('profile')} />
      <section className="workspace-shell">
        <Sidebar channels={channels} channelId={channelId} dms={dms} dmId={dmId} unread={unread} mentions={mentions} isStaff={isStaff} onChannel={(id) => { setChannelId(id); setDmId(null); setThreadParent(null); }} onDm={(id) => { setDmId(id); setThreadParent(null); }} onAdmin={() => setDrawer('admin')} />
        <section className="chat-shell">
          <ChannelHeader dmId={dmId} channel={currentChannel} status={status} onDrawer={setDrawer} />
          <MessageList dmId={dmId} dmMessages={dmMessages} messages={messages} threadParent={threadParent} emojis={emojis} users={users} profile={profile} setThreadParent={setThreadParent} sendThreadMessage={sendThreadMessage} threadMessage={threadMessage} setThreadMessage={setThreadMessage} isStaff={isStaff} session={session} editingId={editingId} editingBody={editingBody} setEditingBody={setEditingBody} reactingTo={reactingTo} setReactingTo={setReactingTo} onEditStart={(item) => { setEditingId(item.id); setEditingBody(item.body); }} onEditSave={saveEdit} onEditCancel={() => setEditingId(null)} onDelete={deleteMessage} onPin={togglePin} onThread={loadThread} onReact={react} />
          <Composer dmId={dmId} value={dmId ? dmMessage : message} setValue={dmId ? setDmMessage : setMessage} onSubmit={dmId ? sendDm : sendMessage} onFile={setAttachmentFile} channel={currentChannel} emojis={emojis} users={users} />
        </section>
        {drawer && <button className="drawer-backdrop" onClick={() => setDrawer(null)} aria-label="Close drawer"></button>}
        <Drawer mode={drawer} close={() => setDrawer(null)} currentChannel={currentChannel} dmId={dmId} search={search} setSearch={setSearch} runSearch={runSearch} searchResults={searchResults} setChannelId={setChannelId} emojis={emojis} setMessage={setMessage} uploadEmoji={uploadEmoji} emojiName={emojiName} setEmojiName={setEmojiName} setEmojiFile={setEmojiFile} deleteEmoji={deleteEmoji} isStaff={isStaff} users={users} startDm={startDm} setModeration={setModeration} channelMembers={channelMembers} toggleChannelMember={toggleChannelMember} auditLogs={auditLogs} createChannel={createChannel} newChannel={newChannel} setNewChannel={setNewChannel} newTopic={newTopic} setNewTopic={setNewTopic} newPrivate={newPrivate} setNewPrivate={setNewPrivate} saveTopic={saveTopic} topic={topic} setTopic={setTopic} session={session} profile={profile} profileName={profileName} setProfileName={setProfileName} saveProfile={saveProfile} signOut={() => supabase.auth.signOut()} />
      </section>
    </main>
  );
}

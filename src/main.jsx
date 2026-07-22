import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const emojiPattern = /:([a-z0-9_]{2,32}):/g;

function renderMessage(body, emojis) {
  const parts = [];
  let lastIndex = 0;

  for (const match of body.matchAll(emojiPattern)) {
    const emoji = emojis.find((item) => item.name === match[1]);
    if (!emoji) continue;
    parts.push(body.slice(lastIndex, match.index));
    parts.push(<img className="emoji" src={emoji.image_url} alt={match[0]} title={match[0]} key={`${match.index}-${emoji.id}`} />);
    lastIndex = match.index + match[0].length;
  }

  parts.push(body.slice(lastIndex));
  return parts;
}

function initials(name = '?') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState({});
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

  const emojiHint = emojis.slice(0, 18).map((emoji) => `:${emoji.name}:`).join(' ');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: auth } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => auth.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;

    Promise.all([
      getOrCreateProfile(),
      supabase.from('channels').select('*').order('created_at'),
      supabase.from('emojis').select('*').order('name'),
    ]).then(([profileResult, channelResult, emojiResult]) => {
      if (profileResult.error || channelResult.error || emojiResult.error) {
        setStatus(profileResult.error?.message || channelResult.error?.message || emojiResult.error?.message);
        return;
      }
      setProfile(profileResult.data);
      setDisplayName(profileResult.data.display_name);
      if (!profileResult.data.approved) return;
      setChannels(channelResult.data);
      setChannelId((current) => current || channelResult.data[0]?.id || null);
      setEmojis(emojiResult.data);
      reloadUsers(profileResult.data.role);
      reloadAudit(profileResult.data.role);
      reloadDms();
      reloadUnread(channelResult.data);
    });

    const room = supabase
      .channel('global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => reloadChannels())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emojis' }, () => reloadEmojis())
      .subscribe();

    return () => supabase.removeChannel(room);
  }, [session]);

  useEffect(() => {
    if (!supabase || !channelId) return;
    setTopic(channels.find((channel) => channel.id === channelId)?.topic || '');
    loadMessages();
    reloadChannelMembers();

    const room = supabase
      .channel(`messages:${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` }, () => loadMessages())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => loadMessages())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` }, (payload) => {
        setMessages((current) => current.filter((item) => item.id !== payload.old.id));
      })
      .subscribe();

    return () => supabase.removeChannel(room);
  }, [channelId, channels]);

  useEffect(() => {
    if (!supabase || !dmId) return;
    loadDmMessages();
    const room = supabase
      .channel(`dm:${dmId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${dmId}` }, () => loadDmMessages())
      .subscribe();
    return () => supabase.removeChannel(room);
  }, [dmId]);

  async function reloadChannels() {
    const { data, error } = await supabase.from('channels').select('*').order('created_at');
    if (error) setStatus(error.message);
    else setChannels(data);
  }

  async function getOrCreateProfile() {
    const existing = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (existing.data || existing.error) return existing;

    const fallbackName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'hackclubber';
    return supabase
      .from('profiles')
      .upsert({ id: session.user.id, email: session.user.email, display_name: fallbackName, approved: true })
      .select('*')
      .single();
  }

  async function reloadEmojis() {
    const { data, error } = await supabase.from('emojis').select('*').order('name');
    if (error) setStatus(error.message);
    else setEmojis(data);
  }

  async function reloadUsers(role = profile?.role) {
    const staff = role === 'mod' || role === 'admin';
    const { data, error } = await supabase
      .from('profiles')
      .select(staff ? 'id, email, display_name, role, moderation!moderation_user_id_fkey(banned, timeout_until, reason)' : 'id, display_name, role')
      .eq('approved', true)
      .order('display_name');
    if (error) setStatus(error.message);
    else setUsers(data);
  }

  async function reloadAudit(role = profile?.role) {
    if (role !== 'mod' && role !== 'admin') return;
    const { data, error } = await supabase.from('audit_logs').select('*, profiles!audit_logs_actor_id_fkey(display_name)').order('created_at', { ascending: false }).limit(50);
    if (error) setStatus(error.message);
    else setAuditLogs(data);
  }

  async function reloadChannelMembers() {
    if (!channelId) return;
    const { data, error } = await supabase.from('channel_members').select('user_id').eq('channel_id', channelId);
    if (!error) setChannelMembers(data.map((item) => item.user_id));
  }

  async function reloadUnread(channelRows = channels) {
    const pairs = await Promise.all(channelRows.map(async (channel) => {
      const receipt = await supabase.from('read_receipts').select('last_read_at').eq('channel_id', channel.id).maybeSingle();
      const since = receipt.data?.last_read_at || '1970-01-01T00:00:00Z';
      const count = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', channel.id).gt('created_at', since).is('parent_id', null);
      return [channel.id, count.count || 0];
    }));
    setUnread(Object.fromEntries(pairs));
  }

  async function reloadDms() {
    const { data, error } = await supabase
      .from('dm_conversations')
      .select('id, created_at, dm_members(profiles(id, display_name))')
      .order('created_at', { ascending: false });
    if (error) setStatus(error.message);
    else setDms(data);
  }

  async function loadMessages() {
    const { data, error } = await supabase
      .from('messages')
      .select('id, body, attachment_url, attachment_name, attachment_type, pinned, edited_at, created_at, user_id, profiles(display_name, role), reactions(emoji_name, user_id)')
      .eq('channel_id', channelId)
      .is('parent_id', null)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(120);
    if (error) setStatus(error.message);
    else {
      setMessages(data.reverse());
      await supabase.from('read_receipts').upsert({ channel_id: channelId, last_read_at: new Date().toISOString() });
      setUnread((current) => ({ ...current, [channelId]: 0 }));
    }
  }

  async function loadDmMessages() {
    const { data, error } = await supabase
      .from('dm_messages')
      .select('id, body, created_at, user_id, profiles(display_name)')
      .eq('conversation_id', dmId)
      .order('created_at')
      .limit(120);
    if (error) setStatus(error.message);
    else setDmMessages(data);
  }

  async function signIn(event) {
    event.preventDefault();
    setStatus('Opening Hack Club Auth...');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'custom:hca',
      options: { redirectTo: location.origin + import.meta.env.BASE_URL },
    });
    if (error) setStatus(error.message);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const name = displayName.trim();
    if (name.length < 2) return setStatus('Display name too short.');
    const { data, error } = await supabase.from('profiles').update({ display_name: name }).eq('id', session.user.id).select().single();
    if (error) setStatus(error.message);
    else {
      setProfile(data);
      setStatus('Profile saved.');
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const body = message.trim();
    if (!body || !channelId) return;
    setMessage('');
    const attachment = await uploadAttachment();
    if (attachment.error) return setStatus(attachment.error.message);
    const { error } = await supabase.from('messages').insert({ channel_id: channelId, body, ...attachment });
    if (error) {
      setMessage(body);
      setStatus(error.message);
    }
  }

  async function uploadAttachment() {
    if (!attachmentFile) return {};
    if (attachmentFile.size > 10 * 1024 * 1024) return { error: { message: 'Attachment max size is 10MB.' } };
    const safeName = attachmentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from('attachments').upload(path, attachmentFile);
    if (upload.error) return { error: upload.error };
    const { data } = supabase.storage.from('attachments').getPublicUrl(path);
    setAttachmentFile(null);
    return { attachment_url: data.publicUrl, attachment_name: attachmentFile.name, attachment_type: attachmentFile.type };
  }

  async function sendThreadMessage(event) {
    event.preventDefault();
    const body = threadMessage.trim();
    if (!body || !threadParent) return;
    setThreadMessage('');
    const { error } = await supabase.from('messages').insert({ channel_id: channelId, parent_id: threadParent.id, body });
    if (error) {
      setThreadMessage(body);
      setStatus(error.message);
    } else loadThread(threadParent);
  }

  async function sendDm(event) {
    event.preventDefault();
    const body = dmMessage.trim();
    if (!body || !dmId) return;
    setDmMessage('');
    const { error } = await supabase.from('dm_messages').insert({ conversation_id: dmId, body });
    if (error) {
      setDmMessage(body);
      setStatus(error.message);
    }
  }

  async function loadThread(parent) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, body, created_at, user_id, profiles(display_name)')
      .eq('parent_id', parent.id)
      .order('created_at');
    if (error) setStatus(error.message);
    else setThreadParent({ ...parent, replies: data });
  }

  async function deleteMessage(id) {
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) setStatus(error.message);
  }

  async function saveEdit(event) {
    event.preventDefault();
    const body = editingBody.trim();
    if (!body || !editingId) return;
    const { data, error } = await supabase.rpc('edit_message', { message_id: editingId, new_body: body });
    if (error) setStatus(error.message);
    else if (!data) setStatus('Cannot edit this message.');
    else {
      setEditingId(null);
      setEditingBody('');
      loadMessages();
    }
  }

  async function togglePin(item) {
    const { error } = await supabase.from('messages').update({ pinned: !item.pinned }).eq('id', item.id);
    if (error) setStatus(error.message);
  }

  async function react(item, emojiName) {
    const exists = item.reactions?.some((reaction) => reaction.user_id === session.user.id && reaction.emoji_name === emojiName);
    const request = exists
      ? supabase.from('reactions').delete().eq('message_id', item.id).eq('emoji_name', emojiName)
      : supabase.from('reactions').insert({ message_id: item.id, emoji_name: emojiName });
    const { error } = await request;
    if (error) setStatus(error.message);
  }

  async function createChannel(event) {
    event.preventDefault();
    const name = newChannel.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(name)) return setStatus('Channel name must be 2-32 chars: a-z, 0-9, underscore, dash.');
    const { error } = await supabase.from('channels').insert({ name, topic: newTopic.trim(), private: newPrivate });
    if (error) setStatus(error.message);
    else {
      setNewChannel('');
      setNewTopic('');
      setNewPrivate(false);
      setStatus('Channel created.');
      audit('channel.create', name);
    }
  }

  async function deleteChannel(id) {
    if (channels.length <= 1) return setStatus('Keep at least one channel.');
    const { error } = await supabase.from('channels').delete().eq('id', id);
    if (error) setStatus(error.message);
    else {
      setChannelId(channels.find((channel) => channel.id !== id)?.id || null);
      audit('channel.delete', id);
    }
  }

  async function saveTopic(event) {
    event.preventDefault();
    const { error } = await supabase.from('channels').update({ topic: topic.trim() }).eq('id', channelId);
    if (error) setStatus(error.message);
    else {
      setStatus('Topic saved.');
      audit('channel.topic', currentChannel?.name || channelId);
    }
  }

  async function setModeration(user, patch) {
    const { error } = await supabase.from('moderation').upsert({ user_id: user.id, updated_by: session.user.id, ...patch });
    if (error) setStatus(error.message);
    else {
      setStatus('Moderation saved.');
      reloadUsers();
      audit('moderation.update', user.display_name);
    }
  }

  async function audit(action, target) {
    await supabase.from('audit_logs').insert({ action, target: String(target || '') });
    reloadAudit();
  }

  async function toggleChannelMember(user) {
    const exists = channelMembers.includes(user.id);
    const request = exists
      ? supabase.from('channel_members').delete().eq('channel_id', channelId).eq('user_id', user.id)
      : supabase.from('channel_members').insert({ channel_id: channelId, user_id: user.id });
    const { error } = await request;
    if (error) setStatus(error.message);
    else {
      reloadChannelMembers();
      audit(exists ? 'channel.member.remove' : 'channel.member.add', user.display_name);
    }
  }

  async function startDm(user) {
    const { data, error } = await supabase.rpc('create_dm', { other_user_id: user.id });
    if (error) setStatus(error.message);
    else {
      setDmId(data);
      reloadDms();
    }
  }

  async function runSearch(event) {
    event.preventDefault();
    const query = search.trim();
    if (!query) return setSearchResults([]);
    const { data, error } = await supabase
      .from('messages')
      .select('id, body, created_at, channel_id, channels(name), profiles(display_name)')
      .ilike('body', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) setStatus(error.message);
    else setSearchResults(data);
  }

  async function uploadEmoji(event) {
    event.preventDefault();
    const name = emojiName.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(name) || !emojiFile) return setStatus('Emoji name must be 2-32 chars: a-z, 0-9, underscore.');
    if (emojiFile.size > 1024 * 1024) return setStatus('Emoji max size is 1MB.');

    const extension = emojiFile.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${crypto.randomUUID()}.${extension}`;
    const upload = await supabase.storage.from('emojis').upload(path, emojiFile, { cacheControl: '31536000' });
    if (upload.error) return setStatus(upload.error.message);

    const { data } = supabase.storage.from('emojis').getPublicUrl(path);
    const insert = await supabase.from('emojis').insert({ name, image_url: data.publicUrl }).select().single();
    if (insert.error) setStatus(insert.error.message);
    else {
      setEmojis((current) => [...current, insert.data].sort((a, b) => a.name.localeCompare(b.name)));
      setEmojiName('');
      setEmojiFile(null);
      event.currentTarget.reset();
    }
  }

  async function deleteEmoji(emoji) {
    const { error } = await supabase.from('emojis').delete().eq('id', emoji.id);
    if (error) setStatus(error.message);
  }

  if (!supabase) return <main className="setup">{status}</main>;

  if (!session) {
    return (
      <main className="login">
        <section>
          <p className="eyebrow">HCHAT</p>
          <h1>Chat for the club.</h1>
          <form onSubmit={signIn}>
            <button className="login-button">Sign in with Hack Club</button>
          </form>
          <p>{status}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="topbar">
        <div className="workspace-pill">HCHAT</div>
        <form className="global-search" onSubmit={runSearch}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" />
        </form>
        <div className="account-chip"><span>{initials(profile?.display_name)}</span>{profile?.display_name}</div>
      </div>
      <section className="app">
      <aside className="leftbar">
        <h1>HCHAT <span className="chev">v</span></h1>
        <form className="profile" onSubmit={saveProfile}>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength="40" />
          <button>Save</button>
        </form>
        <p className="role">{profile?.role || 'member'}</p>

        <p className="section-label">Channels</p>
        <nav>
          {channels.map((channel) => (
            <div className="channel-row" key={channel.id}>
              <button className={channel.id === channelId && !dmId ? 'active' : ''} onClick={() => { setChannelId(channel.id); setDmId(null); }}>
                <span># {channel.name}{channel.private ? ' private' : ''}</span>
                {unread[channel.id] ? <b>{unread[channel.id]}</b> : null}
              </button>
              {isStaff && <button className="danger small" onClick={() => deleteChannel(channel.id)} title="Delete channel">x</button>}
            </div>
          ))}
        </nav>

        <p className="section-label">Direct messages</p>
        <nav>
          {dms.map((dm) => (
            <button className={dm.id === dmId ? 'active' : ''} onClick={() => setDmId(dm.id)} key={dm.id}>
              <span><span className="dot"></span> {dm.dm_members?.map((member) => member.profiles?.display_name).filter(Boolean).join(', ')}</span>
            </button>
          ))}
        </nav>

        {isStaff && (
          <form className="stack" onSubmit={createChannel}>
            <input value={newChannel} onChange={(event) => setNewChannel(event.target.value)} placeholder="new channel" />
            <input value={newTopic} onChange={(event) => setNewTopic(event.target.value)} placeholder="what's it for?" maxLength="160" />
            <label className="check"><input type="checkbox" checked={newPrivate} onChange={(event) => setNewPrivate(event.target.checked)} /> Private</label>
            <button>Create channel</button>
          </form>
        )}

        {isStaff && currentChannel && (
          <form className="stack" onSubmit={saveTopic}>
            <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="channel topic" maxLength="160" />
            <button>Save topic</button>
          </form>
        )}

        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </aside>

      <section className="chat">
        <header>
          <div>
            <strong>{dmId ? 'DM' : `# ${currentChannel?.name || 'channel'}${currentChannel?.private ? ' private' : ''}`}</strong>
            <p>{dmId ? 'Direct message' : currentChannel?.topic}</p>
          </div>
          <span>{status}</span>
        </header>

        <div className="messages">
          {dmId && dmMessages.length === 0 && <div className="empty">No messages here yet. Say hi.</div>}
          {dmId && dmMessages.map((item) => (
            <article className="message-row" key={item.id}>
              <div className="avatar">{initials(item.profiles?.display_name)}</div>
              <div className="meta">
                <strong>{item.profiles?.display_name || 'unknown'}</strong>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
              <p>{renderMessage(item.body, emojis)}</p>
            </article>
          ))}
          {!dmId && threadParent && (
            <section className="thread">
              <button className="link" onClick={() => setThreadParent(null)}>close thread</button>
              <h2>Thread</h2>
              <article className="message-row">
                <div className="avatar">{initials(threadParent.profiles?.display_name)}</div>
                <strong>{threadParent.profiles?.display_name}</strong>
                <p>{renderMessage(threadParent.body, emojis)}</p>
              </article>
              {(threadParent.replies || []).map((reply) => (
                <article className="message-row" key={reply.id}>
                  <div className="avatar">{initials(reply.profiles?.display_name)}</div>
                  <strong>{reply.profiles?.display_name || 'unknown'}</strong>
                  <p>{renderMessage(reply.body, emojis)}</p>
                </article>
              ))}
              <form className="composer inline" onSubmit={sendThreadMessage}>
                <input value={threadMessage} onChange={(event) => setThreadMessage(event.target.value)} placeholder="Reply in thread" maxLength="2000" />
                <button>Reply</button>
              </form>
            </section>
          )}
          {!dmId && !threadParent && messages.length === 0 && <div className="empty">This channel is brand new. First post gets bragging rights.</div>}
          {!dmId && !threadParent && messages.map((item) => (
            <article className="message-row" key={item.id}>
              <div className="avatar">{initials(item.profiles?.display_name)}</div>
              <div className="meta">
                <strong>{item.profiles?.display_name || 'unknown'}</strong>
                {item.pinned && <span className="pill">pinned</span>}
                <small>{new Date(item.created_at).toLocaleString()}</small>
                {isStaff && <button className="link" onClick={() => togglePin(item)}>{item.pinned ? 'unpin' : 'pin'}</button>}
                <button className="link" onClick={() => loadThread(item)}>thread</button>
                {item.edited_at && <span className="pill">edited</span>}
                {item.user_id === session.user.id && <button className="link" onClick={() => { setEditingId(item.id); setEditingBody(item.body); }}>edit</button>}
                {(item.user_id === session.user.id || isStaff) && <button className="link" onClick={() => deleteMessage(item.id)}>delete</button>}
              </div>
              {editingId === item.id ? (
                <form className="inline" onSubmit={saveEdit}>
                  <input value={editingBody} onChange={(event) => setEditingBody(event.target.value)} maxLength="2000" />
                  <button>Save</button>
                  <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                </form>
              ) : <p>{renderMessage(item.body, emojis)}</p>}
              {item.attachment_url && <a className="attachment" href={item.attachment_url} target="_blank" rel="noreferrer">{item.attachment_name || 'attachment'}</a>}
              <div className="reactions">
                {Object.entries((item.reactions || []).reduce((acc, reaction) => ({ ...acc, [reaction.emoji_name]: (acc[reaction.emoji_name] || 0) + 1 }), {})).map(([name, count]) => (
                  <button onClick={() => react(item, name)} key={name}>:{name}: {count}</button>
                ))}
                {emojis.slice(0, 6).map((emoji) => <button onClick={() => react(item, emoji.name)} key={emoji.id}>:{emoji.name}:</button>)}
              </div>
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={dmId ? sendDm : sendMessage}>
          <input value={dmId ? dmMessage : message} onChange={(event) => dmId ? setDmMessage(event.target.value) : setMessage(event.target.value)} placeholder={dmId ? 'Message this person' : `Message #${currentChannel?.name || 'channel'}`} maxLength="2000" />
          {!dmId && <input type="file" onChange={(event) => setAttachmentFile(event.target.files[0])} />}
          <button>Send</button>
        </form>
      </section>

      <aside className="rightbar">
        <h2>About</h2>
        <div className="panel-card">
          <strong>{dmId ? 'Direct message' : `# ${currentChannel?.name || 'channel'}`}</strong>
          <p>{dmId ? 'Private conversation' : currentChannel?.topic || 'No topic yet'}</p>
        </div>
        <h2>Find stuff</h2>
        <form className="stack" onSubmit={runSearch}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="find messages" />
          <button>Search</button>
        </form>
        <div className="results">
          {searchResults.map((item) => (
            <button onClick={() => setChannelId(item.channel_id)} key={item.id}>
              <small>#{item.channels?.name} · {item.profiles?.display_name}</small>
              <span>{item.body}</span>
            </button>
          ))}
        </div>

        <h2>Emoji</h2>
        <div className="emoji-grid">
          {emojis.map((emoji) => (
            <button className="emoji-tile" onClick={() => setMessage((current) => `${current} :${emoji.name}:`.trimStart())} key={emoji.id}>
              <img src={emoji.image_url} alt={`:${emoji.name}:`} title={`:${emoji.name}:`} />
              {(emoji.created_by === session.user.id || isStaff) && <span onClick={(event) => { event.stopPropagation(); deleteEmoji(emoji); }}>x</span>}
            </button>
          ))}
        </div>
        <form className="stack" onSubmit={uploadEmoji}>
          <input value={emojiName} onChange={(event) => setEmojiName(event.target.value)} placeholder="party_blob" />
          <input type="file" accept="image/png,image/webp,image/gif" onChange={(event) => setEmojiFile(event.target.files[0])} />
          <button>Upload emoji</button>
        </form>

        <h2>People</h2>
        <div className="users">
          {users.map((user) => (
            <article key={user.id}>
              <strong><span className="dot"></span> {user.display_name}</strong>
              <small>{user.email ? `${user.email} · ` : ''}{user.role}</small>
              <button onClick={() => startDm(user)}>DM</button>
            </article>
          ))}
        </div>

        {isStaff && (
          <>
            <h2>Moderation</h2>
            <div className="users">
              {users.map((user) => (
                <article key={user.id}>
                  <strong>{user.display_name}</strong>
                  <small>{user.email} · {user.role}</small>
                  <small>{user.moderation?.banned ? 'banned' : user.moderation?.timeout_until ? `timeout until ${new Date(user.moderation.timeout_until).toLocaleString()}` : 'clear'}</small>
                  <div className="button-row">
                    <button onClick={() => startDm(user)}>DM</button>
                    <button onClick={() => setModeration(user, { banned: false, timeout_until: null, reason: '' })}>Clear</button>
                    <button onClick={() => setModeration(user, { banned: false, timeout_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(), reason: '1h timeout' })}>1h</button>
                    <button className="danger" onClick={() => setModeration(user, { banned: true, timeout_until: null, reason: 'banned' })}>Ban</button>
                  </div>
                </article>
              ))}
            </div>
            {currentChannel?.private && (
              <>
                <h2>Private Members</h2>
                <div className="users">
                  {users.map((user) => (
                    <article key={user.id}>
                      <strong>{user.display_name}</strong>
                      <button onClick={() => toggleChannelMember(user)}>{channelMembers.includes(user.id) ? 'Remove' : 'Add'}</button>
                    </article>
                  ))}
                </div>
              </>
            )}
            <h2>Audit</h2>
            <div className="results">
              {auditLogs.map((log) => (
                <button key={log.id}>
                  <small>{new Date(log.created_at).toLocaleString()} · {log.profiles?.display_name || 'system'}</small>
                  <span>{log.action}: {log.target}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);

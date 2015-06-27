'use strict';

import { L10nError } from '../../errors';

const MAX_PLACEABLES = 100;

export default {
  _patterns: null,

  init: function() {
    this._patterns = {
      index: /@cldr\.plural\(\$?(\w+)\)/g,
      placeables: /\{\{\s*\$?([^\s]*?)\s*\}\}/,
      unesc: /\\({{|u[0-9a-fA-F]{4}|.)/g,
    };
  },

  parse: function (env, string, simple) {
    if (!this._patterns) {
      this.init();
    }
    this._source = string;
    this._index = 0;
    this._length = this._source.length;
    this.simpleMode = simple;
    this.env = env;

    return this.getL20n();
  },

  getAttributes: function() {
    let attrs = Object.create(null);

    while (true) {
      let attr = this.getKVPWithIndex();
      attrs[attr[0]] = attr[1];
      const ws1 = this.getRequiredWS();
      const ch = this._source.charAt(this._index);
      if (ch === '>') {
        break;
      } else if (!ws1) {
        throw this.error('Expected ">"');
      }
    }
    return attrs;
  },

  getKVP: function() {
    const key = this.getIdentifier();
    this.getWS();
    if (this._source.charAt(this._index) !== ':') {
      throw this.error('Expected ":"');
    }
    ++this._index;
    this.getWS();
    return [key, this.getValue()];
  },

  getKVPWithIndex: function() {
    const key = this.getIdentifier();
    let index = null;

    if (this._source.charAt(this._index) === '[') {
      ++this._index;
      this.getWS();
      index = this.getIndex();
    }
    this.getWS();
    if (this._source.charAt(this._index) !== ':') {
      throw this.error('Expected ":"');
    }
    ++this._index;
    this.getWS();
    return [
      key,
      this.getValue(false, undefined, index)
    ];
  },

  getHash: function() {
    ++this._index;
    this.getWS();
    let hash = {};
    while (true) {
      const hi = this.getKVP();
      hash[hi[0]] = hi[1];
      this.getWS();

      const comma = this._source.charAt(this._index) === ',';
      if (comma) {
        ++this._index;
        this.getWS();
      }
      if (this._source.charAt(this._index) === '}') {
        ++this._index;
        break;
      }
      if (!comma) {
        throw this.error('Expected "}"');
      }
    }
    return hash;
  },

  unescapeString: function(str, opchar) {
    function replace(match, p1) {
      switch (p1) {
        case '\\':
          return '\\';
        case '{{':
          return '{{';
        case opchar:
          return opchar;
        default:
          if (p1.length === 5 && p1.charAt(0) === 'u') {
            return String.fromCharCode(parseInt(p1.substr(1), 16));
          }
          throw this.error('Illegal unescape sequence');
      }
    }
    return str.replace(this._patterns.unesc, replace.bind(this));
  },

  getString: function(opchar) {
    let opcharPos = this._source.indexOf(opchar, this._index + 1);

    outer:
    while (opcharPos !== -1) {
      let backtrack = opcharPos - 1;
      // 92 === '\'
      while (this._source.charCodeAt(backtrack) === 92) {
        if (this._source.charCodeAt(backtrack - 1) === 92) {
          backtrack -= 2;
        } else {
          opcharPos = this._source.indexOf(opchar, opcharPos + 1);
          continue outer;
        }
      }
      break;
    }

    if (opcharPos === -1) {
      throw this.error('Unclosed string literal');
    }

    let buf = this._source.slice(this._index + 1, opcharPos);

    this._index = opcharPos + 1;

    if (!this.simpleMode && buf.indexOf('\\') !== -1) {
      buf = this.unescapeString(buf, opchar);
    }

    if (!this.simpleMode && buf.indexOf('{{') !== -1) {
      return this.parseString(buf);
    }

    return buf;
  },

  getValue: function(optional, ch, index) {
    let val;

    if (ch === undefined) {
      ch = this._source.charAt(this._index);
    }
    if (ch === '\'' || ch === '"') {
      val = this.getString(ch);
    } else if (ch === '{') {
      val = this.getHash();
    }

    if (val === undefined) {
      if (!optional) {
        throw this.error('Unknown value type');
      }
      return null;
    }

    if (index) {
      return {'$v': val, '$x': index};
    }

    return val;
  },

  getRequiredWS: function() {
    const pos = this._index;
    let cc = this._source.charCodeAt(pos);
    // space, \n, \t, \r
    while (cc === 32 || cc === 10 || cc === 9 || cc === 13) {
      cc = this._source.charCodeAt(++this._index);
    }
    return this._index !== pos;
  },

  getWS: function() {
    let cc = this._source.charCodeAt(this._index);
    // space, \n, \t, \r
    while (cc === 32 || cc === 10 || cc === 9 || cc === 13) {
      cc = this._source.charCodeAt(++this._index);
    }
  },

  getIdentifier: function() {
    const start = this._index;
    let cc = this._source.charCodeAt(this._index);

    if ((cc >= 97 && cc <= 122) || // a-z
        (cc >= 65 && cc <= 90) ||  // A-Z
        cc === 95) {               // _
      cc = this._source.charCodeAt(++this._index);
    } else {
      throw this.error('Identifier has to start with [a-zA-Z_]');
    }

    while ((cc >= 97 && cc <= 122) || // a-z
           (cc >= 65 && cc <= 90) ||  // A-Z
           (cc >= 48 && cc <= 57) ||  // 0-9
           cc === 95) {               // _
      cc = this._source.charCodeAt(++this._index);
    }

    return this._source.slice(start, this._index);
  },

  getComment: function() {
    this._index += 2;
    const start = this._index;
    const end = this._source.indexOf('*/', start);

    if (end === -1) {
      throw this.error('Comment without closing tag');
    }
    this._index = end + 2;
    return;
  },

  getEntity: function(id, index) {
    const entity = {'$i': id};

    if (index) {
      entity.$x = index;
    }

    if (!this.getRequiredWS()) {
      throw this.error('Expected white space');
    }

    const ch = this._source.charAt(this._index);
    const value = this.getValue(index === null, ch);
    let attrs = null;
    if (value === null) {
      if (ch === '>') {
        throw this.error('Expected ">"');
      }
      attrs = this.getAttributes();
    } else {
      entity.$v = value;
      const ws1 = this.getRequiredWS();
      if (this._source.charAt(this._index) !== '>') {
        if (!ws1) {
          throw this.error('Expected ">"');
        }
        attrs = this.getAttributes();
      }
    }

    // skip '>'
    ++this._index;

    if (attrs) {
      /* jshint -W089 */
      for (let key in attrs) {
        entity[key] = attrs[key];
      }
    }

    return entity;
  },

  getEntry: function() {
    // 60 === '<'
    if (this._source.charCodeAt(this._index) === 60) {
      ++this._index;
      const id = this.getIdentifier();
      // 91 == '['
      if (this._source.charCodeAt(this._index) === 91) {
        ++this._index;
        return this.getEntity(id,
                         this.getIndex());
      }
      return this.getEntity(id, null);
    }
    if (this._source.charCodeAt(this._index) === 47 &&
        this._source.charCodeAt(this._index + 1) === 42) {
      return this.getComment();
    }
    throw this.error('Invalid entry');
  },

  getL20n: function() {
    const ast = [];

    this.getWS();
    while (this._index < this._length) {
      try {
        const entry = this.getEntry();
        if (entry) {
          ast.push(entry);
        }
      } catch (e) {
        if (this.env) {
          this.env.emit('parseerror', e);
        } else {
          throw e;
        }
      }

      if (this._index < this._length) {
        this.getWS();
      }
    }

    return ast;
  },

  getIndex: function() {
    this.getWS();
    this._patterns.index.lastIndex = this._index;
    const match = this._patterns.index.exec(this._source);
    this._index = this._patterns.index.lastIndex;
    this.getWS();
    this._index++;

    return [{t: 'idOrVar', v: 'plural'}, match[1]];
  },

  parseString: function(str) {
    const chunks = str.split(this._patterns.placeables);
    const complexStr = [];

    const len = chunks.length;
    const placeablesCount = (len - 1) / 2;

    if (placeablesCount >= MAX_PLACEABLES) {
      throw new L10nError('Too many placeables (' + placeablesCount +
                          ', max allowed is ' + MAX_PLACEABLES + ')');
    }

    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].length === 0) {
        continue;
      }
      if (i % 2 === 1) {
        complexStr.push({t: 'idOrVar', v: chunks[i]});
      } else {
        complexStr.push(chunks[i]);
      }
    }
    return complexStr;
  },

  error: function(message, pos) {
    if (pos === undefined) {
      pos = this._index;
    }
    let start = this._source.lastIndexOf('<', pos - 1);
    const lastClose = this._source.lastIndexOf('>', pos - 1);
    start = lastClose > start ? lastClose + 1 : start;
    const context = this._source.slice(start, pos + 10);

    const msg = message + ' at pos ' + pos + ': "' + context + '"';
    return new L10nError(msg, pos, context);
  }
};

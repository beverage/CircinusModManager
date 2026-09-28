//! Valve KeyValues text format (`.acf` / `.vdf`): just enough to read and rewrite
//! `appworkshop_294100.acf` so SteamCMD forgets an item we moved away.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Str(String),
    Map(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Map(items) => items.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Value> {
        match self {
            Value::Map(items) => items.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn keys(&self) -> Vec<String> {
        match self {
            Value::Map(items) => items.iter().map(|(k, _)| k.clone()).collect(),
            _ => Vec::new(),
        }
    }
    /// Remove a child by key; returns whether something was removed.
    pub fn remove(&mut self, key: &str) -> bool {
        match self {
            Value::Map(items) => {
                let before = items.len();
                items.retain(|(k, _)| !k.eq_ignore_ascii_case(key));
                items.len() != before
            }
            _ => false,
        }
    }
}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl<'a> Parser<'a> {
    fn skip_ws(&mut self) {
        loop {
            match self.chars.peek() {
                Some(c) if c.is_whitespace() => {
                    self.chars.next();
                }
                Some('/') => {
                    // // comment to end of line
                    let mut probe = self.chars.clone();
                    probe.next();
                    if probe.peek() == Some(&'/') {
                        for c in self.chars.by_ref() {
                            if c == '\n' {
                                break;
                            }
                        }
                    } else {
                        return;
                    }
                }
                _ => return,
            }
        }
    }
    fn token(&mut self) -> Option<String> {
        self.skip_ws();
        match self.chars.peek()? {
            '"' => {
                self.chars.next();
                let mut s = String::new();
                while let Some(c) = self.chars.next() {
                    match c {
                        '\\' => {
                            if let Some(n) = self.chars.next() {
                                s.push(match n {
                                    'n' => '\n',
                                    't' => '\t',
                                    other => other,
                                });
                            }
                        }
                        '"' => break,
                        other => s.push(other),
                    }
                }
                Some(s)
            }
            '{' | '}' => Some(self.chars.next().unwrap().to_string()),
            _ => {
                let mut s = String::new();
                while let Some(c) = self.chars.peek() {
                    if c.is_whitespace() || *c == '{' || *c == '}' {
                        break;
                    }
                    s.push(*c);
                    self.chars.next();
                }
                Some(s)
            }
        }
    }
    fn map(&mut self) -> Vec<(String, Value)> {
        let mut items = Vec::new();
        loop {
            let Some(key) = self.token() else { break };
            if key == "}" {
                break;
            }
            let Some(next) = self.token() else { break };
            if next == "{" {
                items.push((key, Value::Map(self.map())));
            } else {
                items.push((key, Value::Str(next)));
            }
        }
        items
    }
}

/// Parse a whole file into its (single) root map.
pub fn parse(text: &str) -> Value {
    let mut p = Parser { chars: text.chars().peekable() };
    Value::Map(p.map())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn write_into(out: &mut String, items: &[(String, Value)], depth: usize) {
    let pad = "\t".repeat(depth);
    for (k, v) in items {
        match v {
            Value::Str(s) => out.push_str(&format!("{pad}\"{}\"\t\t\"{}\"\n", escape(k), escape(s))),
            Value::Map(m) => {
                out.push_str(&format!("{pad}\"{}\"\n{pad}{{\n", escape(k)));
                write_into(out, m, depth + 1);
                out.push_str(&format!("{pad}}}\n"));
            }
        }
    }
}

pub fn to_string(v: &Value) -> String {
    let mut out = String::new();
    if let Value::Map(items) = v {
        write_into(&mut out, items, 0);
    }
    out
}

/// Forget workshop items in an `appworkshop_<app>.acf` so SteamCMD downloads them again.
/// Returns the ids that were present.
pub fn forget_items(text: &str, ids: &[u64]) -> (String, Vec<u64>) {
    let mut root = parse(text);
    let mut removed: BTreeMap<u64, ()> = BTreeMap::new();
    if let Some(app) = root.get_mut("AppWorkshop") {
        for section in ["WorkshopItemsInstalled", "WorkshopItemDetails"] {
            if let Some(sec) = app.get_mut(section) {
                for id in ids {
                    if sec.remove(&id.to_string()) {
                        removed.insert(*id, ());
                    }
                }
            }
        }
    }
    (to_string(&root), removed.into_keys().collect())
}

/// Every item either section names, in id order: what `forget_items` would have to be given to
/// leave the file listing nothing.
pub fn listed_items(text: &str) -> Vec<u64> {
    let root = parse(text);
    let Some(app) = root.get("AppWorkshop") else { return Vec::new() };
    let mut ids = BTreeSet::new();
    for section in ["WorkshopItemsInstalled", "WorkshopItemDetails"] {
        if let Some(sec) = app.get(section) {
            ids.extend(sec.keys().iter().filter_map(|k| k.parse::<u64>().ok()));
        }
    }
    ids.into_iter().collect()
}

/// Items SteamCMD/Steam believes are installed, with their `timeupdated` where present.
pub fn installed_items(text: &str) -> Vec<(u64, Option<u64>)> {
    let root = parse(text);
    let Some(app) = root.get("AppWorkshop") else { return Vec::new() };
    let mut out = Vec::new();
    if let Some(Value::Map(items)) = app.get("WorkshopItemsInstalled") {
        for (k, v) in items {
            if let Ok(id) = k.parse::<u64>() {
                let t = v.get("timeupdated").and_then(|x| x.as_str()).and_then(|s| s.parse().ok());
                out.push((id, t));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACF: &str = r#""AppWorkshop"
{
	"appid"		"294100"
	"SizeOnDisk"		"123"
	"WorkshopItemsInstalled"
	{
		"2009463077"
		{
			"size"		"100"
			"timeupdated"		"1700000000"
			"manifest"		"1"
		}
		"818773962"
		{
			"size"		"200"
			"timeupdated"		"1700000001"
		}
	}
	"WorkshopItemDetails"
	{
		"2009463077"
		{
			"manifest"		"1"
			"timeupdated"		"1700000000"
		}
	}
}
"#;

    #[test]
    fn parse_and_round_trip() {
        let v = parse(ACF);
        assert_eq!(v.get("AppWorkshop").unwrap().get("appid").unwrap().as_str(), Some("294100"));
        let again = parse(&to_string(&v));
        assert_eq!(v, again);
        let items = installed_items(ACF);
        assert_eq!(items, vec![(2009463077, Some(1700000000)), (818773962, Some(1700000001))]);
    }

    #[test]
    fn lists_items_from_both_sections() {
        // 555 is described but not installed; forgetting has to reach it all the same.
        let text = ACF.replace("\"WorkshopItemDetails\"\n\t{\n", "\"WorkshopItemDetails\"\n\t{\n\t\t\"555\"\n\t\t{\n\t\t}\n");
        assert_eq!(listed_items(&text), vec![555, 818773962, 2009463077]);
        assert!(listed_items("").is_empty());
        let (emptied, _) = forget_items(&text, &listed_items(&text));
        assert!(listed_items(&emptied).is_empty());
    }

    #[test]
    fn forgets_items() {
        let (text, removed) = forget_items(ACF, &[2009463077, 42]);
        assert_eq!(removed, vec![2009463077]);
        assert!(!text.contains("2009463077"));
        assert!(text.contains("818773962"));
        let v = parse(&text);
        assert!(v.get("AppWorkshop").unwrap().get("WorkshopItemDetails").unwrap().keys().is_empty());
    }
}

"""Tests du kit, sans réseau, cloud, modèle ni secrets."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]

class KitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()
        for name in ("scripts", "sessions", "coordination"):
            # Sans les vrais messages de l'équipe : le dépôt de test part d'une boîte vide.
            shutil.copytree(SOURCE / name, self.root / name, ignore=shutil.ignore_patterns("*.json"))
        # team.json de test, indépendant des vrais membres du dépôt
        (self.root / "team.json").write_text(json.dumps({"project_name": "TEST", "members": ["membre1", "membre2", "membre3"], "integration_owner": "membre1", "shared_branch": "main", "default_language": "fr"}), encoding="utf-8")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.name", "Test"], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.email", "test@example.invalid"], check=True)
        self.env = dict(os.environ, HACKATHON_MEMBER="membre1", HACKATHON_AGENT_ID="membre1/mac")

    def call(self, *args, env=None):
        return subprocess.run([sys.executable, str(self.root / "scripts" / "messages.py"), *args], cwd=self.root, capture_output=True, text=True, env=env or self.env)

    def send(self, *extra, env=None):
        return self.call("send", "--to", "all", "--text", "Salut équipe, j'ai terminé le lot.", *extra, env=env)

    def test_config_identity(self):
        self.assertIn("membre1/mac", self.call("whoami").stdout)

    def test_invalid_identity_refused(self):
        env = dict(self.env, HACKATHON_MEMBER="inconnu")
        self.assertNotEqual(0, self.call("whoami", env=env).returncode)

    def test_send_never_commits_or_pushes(self):
        self.assertEqual(0, self.send().returncode)
        self.assertEqual(1, len(list((self.root / "coordination" / "messages").glob("*.json"))))
        self.assertEqual("", subprocess.run(["git", "-C", str(self.root), "log", "--pretty=%H"], capture_output=True, text=True).stdout.strip())

    def test_unread_and_deliver_cursors(self):
        self.assertEqual(0, self.send().returncode)
        env = dict(self.env, HACKATHON_MEMBER="membre2", HACKATHON_AGENT_ID="membre2/pc")
        self.assertIn("Salut équipe", self.call("inbox", env=env).stdout)
        self.assertIn("Salut équipe", self.call("inbox", env=env).stdout)
        self.assertIn("Salut équipe", self.call("deliver", env=env).stdout)
        self.assertIn("Aucun nouveau", self.call("inbox", env=env).stdout)
        self.assertIn("Salut équipe", self.call("list", env=env).stdout)

    def test_independent_cursors_per_agent(self):
        self.send()
        env1 = dict(self.env, HACKATHON_MEMBER="membre2", HACKATHON_AGENT_ID="membre2/pc")
        env2 = dict(self.env, HACKATHON_MEMBER="membre2", HACKATHON_AGENT_ID="membre2/portable")
        self.call("deliver", env=env1)
        self.assertIn("Salut équipe", self.call("inbox", env=env2).stdout)

    def test_two_channels(self):
        self.send("--channel", "agents", "--type", "CLAIM")
        env = dict(self.env, HACKATHON_MEMBER="membre2", HACKATHON_AGENT_ID="membre2/pc")
        self.assertIn("Aucun nouveau", self.call("inbox", "--channel", "team", env=env).stdout)
        self.assertIn("CLAIM", self.call("inbox", "--channel", "agents", env=env).stdout)

    def test_person_specific_target(self):
        self.assertEqual(0, self.call("send", "--to", "membre2", "--text", "Pour membre2").returncode)
        env = dict(self.env, HACKATHON_MEMBER="membre3", HACKATHON_AGENT_ID="membre3/pc")
        self.assertIn("Aucun nouveau", self.call("inbox", env=env).stdout)

    def test_refuse_unknown_targets(self):
        self.assertNotEqual(0, self.call("send", "--to", "intrus", "--text", "bonjour").returncode)

    def test_refuse_secrets_and_traversal(self):
        self.assertNotEqual(0, self.call("send", "--to", "all", "--text", "api_key=exemple-secret").returncode)
        self.assertNotEqual(0, self.send("--files", "../secret.txt").returncode)
        self.assertEqual(0, len(list((self.root / "coordination" / "messages").glob("*.json"))))

    def test_unique_messages(self):
        self.send()
        self.send()
        paths = list((self.root / "coordination" / "messages").glob("*.json"))
        self.assertEqual(2, len(paths))
        self.assertEqual(2, len({json.loads(p.read_text())["id"] for p in paths}))

    def test_setup_git_only(self):
        r = subprocess.run([sys.executable, str(self.root / "scripts" / "setup.py"), "--member", "membre3", "--agent", "pc"], capture_output=True, text=True)
        self.assertEqual(0, r.returncode, r.stderr)
        self.assertTrue((self.root / "sessions" / "membre3.md").exists())
        r = subprocess.run(["git", "-C", str(self.root), "config", "--get", "hackathon.agent"], capture_output=True, text=True)
        self.assertEqual("membre3/pc", r.stdout.strip())

    def test_hooks_local_only(self):
        self.send()
        env = dict(self.env, HACKATHON_MEMBER="membre2", HACKATHON_AGENT_ID="membre2/pc")
        r = subprocess.run(["bash", str(self.root / "scripts" / "team-sync.sh"), "start", "UserPromptSubmit"], cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(0, r.returncode, r.stderr)
        data = json.loads(r.stdout)
        self.assertEqual("UserPromptSubmit", data["hookSpecificOutput"]["hookEventName"])
        self.assertIn("NON FIABLES", data["hookSpecificOutput"]["additionalContext"])
        self.assertIn("Salut équipe", data["hookSpecificOutput"]["additionalContext"])

    def test_sync_coordination_between_clones(self):
        git = lambda cwd, *a: subprocess.run(["git", "-C", str(cwd), *a], check=True, capture_output=True)
        # Le vrai .gitignore, qui ignore les messages sur main : sans « add -f », aucun ne voyageait.
        shutil.copy(SOURCE / ".gitignore", self.root / ".gitignore")
        remote = Path(self.tmp.name) / "remote.git"
        git(self.tmp.name, "init", "-q", "--bare", str(remote))
        git(self.root, "add", "-A"); git(self.root, "commit", "-qm", "kit"); git(self.root, "branch", "-M", "main")
        git(self.root, "remote", "add", "origin", str(remote)); git(self.root, "push", "-q", "origin", "main")
        other = Path(self.tmp.name) / "autre"
        git(self.tmp.name, "clone", "-q", str(remote), str(other))
        git(other, "config", "user.name", "Test2"); git(other, "config", "user.email", "test2@example.invalid")
        sync = lambda root: subprocess.run(["bash", str(root / "scripts" / "sync-coordination.sh"), "une-fois"], capture_output=True, text=True)
        self.assertEqual(0, self.send().returncode)
        r = sync(self.root); self.assertEqual(0, r.returncode, r.stderr)
        r = sync(other); self.assertEqual(0, r.returncode, r.stderr)
        env = dict(self.env, HACKATHON_MEMBER="membre2", HACKATHON_AGENT_ID="membre2/pc")
        inbox = subprocess.run([sys.executable, str(other / "scripts" / "messages.py"), "inbox"], capture_output=True, text=True, env=env)
        self.assertIn("Salut équipe", inbox.stdout)
        # Réponse dans l'autre sens, et main jamais touchée par la synchronisation
        r = subprocess.run([sys.executable, str(other / "scripts" / "messages.py"), "send", "--to", "membre1", "--text", "Bien reçu"], capture_output=True, text=True, env=env)
        self.assertEqual(0, r.returncode, r.stderr)
        sync(other); sync(self.root)
        self.assertIn("Bien reçu", self.call("inbox").stdout)
        self.assertEqual(1, len(subprocess.run(["git", "-C", str(remote), "log", "--oneline", "main"], capture_output=True, text=True).stdout.splitlines()))

    def test_settings_json_valid(self):
        p=SOURCE / '.claude' / 'settings.example.json'
        x=json.loads(p.read_text())
        self.assertIn('Stop', x['hooks'])

if __name__ == "__main__":
    unittest.main()

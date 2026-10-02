export interface SampleDiff {
  id: string;
  title: string;
  description: string;
  diff: string;
}

const ANGULAR = `diff --git a/src/app/users/user-list.component.ts b/src/app/users/user-list.component.ts
new file mode 100644
index 0000000..8d2f6a1
--- /dev/null
+++ b/src/app/users/user-list.component.ts
@@ -0,0 +1,49 @@
+import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
+import { FormControl, ReactiveFormsModule } from '@angular/forms';
+import { debounceTime } from 'rxjs';
+import { User, UserService } from './user.service';
+
+@Component({
+  selector: 'app-user-list',
+  imports: [ReactiveFormsModule],
+  templateUrl: './user-list.component.html',
+})
+export class UserListComponent implements OnInit {
+  private readonly users = inject(UserService);
+  @ViewChild('bio') bio!: ElementRef<HTMLDivElement>;
+
+  search = new FormControl('');
+  all: User[] = [];
+  visible: User[] = [];
+  selected: any;
+
+  ngOnInit(): void {
+    this.users.list().subscribe((list) => {
+      this.all = list;
+      this.visible = list;
+    });
+
+    this.search.valueChanges.pipe(debounceTime(300)).subscribe((term) => {
+      console.log('search', term);
+      this.visible = this.all.filter((u) => u.name.toLowerCase().includes((term ?? '').toLowerCase()));
+    });
+  }
+
+  select(user: User): void {
+    this.selected = user;
+    // TODO: sanitize the bio before rendering it
+    this.bio.nativeElement.innerHTML = user.bio;
+  }
+
+  isAdmin(user: User): boolean {
+    return user.role == 'admin';
+  }
+
+  async refresh() {
+    this.users.list().subscribe((list) => (this.all = list));
+  }
+
+  hasMany(): boolean {
+    return this.visible.length > 25;
+  }
+}
diff --git a/src/app/users/user-list.component.html b/src/app/users/user-list.component.html
new file mode 100644
index 0000000..51c0e9b
--- /dev/null
+++ b/src/app/users/user-list.component.html
@@ -0,0 +1,16 @@
+<section class="users">
+  <label for="search">Search users</label>
+  <input id="search" type="search" [formControl]="search" />
+
+  <ul>
+    @for (user of visible; track user.id) {
+      <li (click)="select(user)">
+        <img [src]="user.avatarUrl" class="avatar">
+        <span>{{ user.name }}</span>
+      </li>
+    }
+  </ul>
+
+  <div #bio class="bio"></div>
+  <img src="assets/avatar-placeholder.png" alt="" class="placeholder" />
+</section>
diff --git a/src/app/users/user.service.ts b/src/app/users/user.service.ts
index 4a1b2c3..9e8f7d6 100644
--- a/src/app/users/user.service.ts
+++ b/src/app/users/user.service.ts
@@ -1,16 +1,23 @@
 import { HttpClient } from '@angular/common/http';
 import { Injectable, inject } from '@angular/core';
+import { Observable } from 'rxjs';

 export interface User {
   id: number;
   name: string;
+  role: 'admin' | 'member';
+  avatarUrl: string;
+  bio: string;
 }

 @Injectable({ providedIn: 'root' })
 export class UserService {
   private readonly http = inject(HttpClient);
+  private readonly apiKey = 'k3y-live-4f9a2c7e1b8d';

-  list() {
-    return this.http.get<User[]>('/api/users');
+  list(): Observable<User[]> {
+    return this.http.get<User[]>('/api/users', {
+      headers: { 'x-api-key': this.apiKey },
+    });
   }
 }
diff --git a/src/app/users/user-list.component.spec.ts b/src/app/users/user-list.component.spec.ts
new file mode 100644
index 0000000..c4d5e6f
--- /dev/null
+++ b/src/app/users/user-list.component.spec.ts
@@ -0,0 +1,29 @@
+import { TestBed } from '@angular/core/testing';
+import { of } from 'rxjs';
+import { UserListComponent } from './user-list.component';
+import { UserService } from './user.service';
+
+describe('UserListComponent', () => {
+  const users = [
+    { id: 1, name: 'Ada', role: 'admin' as const, avatarUrl: '', bio: '' },
+    { id: 2, name: 'Linus', role: 'member' as const, avatarUrl: '', bio: '' },
+  ];
+
+  beforeEach(() => {
+    TestBed.configureTestingModule({
+      imports: [UserListComponent],
+      providers: [{ provide: UserService, useValue: { list: () => of(users) } }],
+    });
+  });
+
+  fit('shows every user on load', () => {
+    const fixture = TestBed.createComponent(UserListComponent);
+    fixture.detectChanges();
+    expect(fixture.componentInstance.visible.length).toBe(2);
+  });
+
+  it('flags admins', () => {
+    const component = TestBed.createComponent(UserListComponent).componentInstance;
+    expect(component.isAdmin(users[0])).toBeTrue();
+  });
+});
diff --git a/src/assets/avatar-placeholder.png b/src/assets/avatar-placeholder.png
new file mode 100644
index 0000000..3f4c2a1
Binary files /dev/null and b/src/assets/avatar-placeholder.png differ
`;

const NODE = `diff --git a/server/config.js b/server/config.js
index 1f2e3d4..5c6b7a8 100644
--- a/server/config.js
+++ b/server/config.js
@@ -1,8 +1,11 @@
-const port = process.env.PORT || 3000;
+var port = process.env.PORT || 3000;

 module.exports = {
   port,
   db: {
     url: process.env.DATABASE_URL,
   },
+  stripe: {
+    webhookSecret: "wh-9b1f2e7a6c4d8e3f",
+  },
 };
diff --git a/server/routes/webhook.js b/server/routes/webhook.js
new file mode 100644
index 0000000..a1b2c3d
--- /dev/null
+++ b/server/routes/webhook.js
@@ -0,0 +1,33 @@
+const express = require('express');
+const { verifySignature } = require('../utils/signature');
+const config = require('../config');
+
+const router = express.Router();
+
+router.post('/webhook', async (req, res) => {
+  const signature = req.headers['stripe-signature'];
+  if (signature == undefined) {
+    return res.status(400).send('Missing signature');
+  }
+
+  let event;
+  try {
+    event = verifySignature(req.body, signature, config.stripe.webhookSecret);
+  } catch (err) {}
+
+  debugger;
+  const handler = eval('handle_' + event.type);
+  handler(event.data.object);
+
+  if (event.data.object.amount > 50000) {
+    notifyFinance(event);
+  }
+  res.json({ received: true });
+});
+
+async function notifyFinance(event) {
+  const message = 'Large payment received: ' + event.data.object.amount + ' from customer ' + event.data.object.customer + ' (' + event.id + ')';
+  return fetch(process.env.FINANCE_HOOK, { method: 'POST', body: JSON.stringify({ text: message }) });
+}
+
+module.exports = router;
diff --git a/server/legacy/old-handler.js b/server/routes/handler.js
similarity index 92%
rename from server/legacy/old-handler.js
rename to server/routes/handler.js
index 4b1d2e3..9c8a7f6 100644
--- a/server/legacy/old-handler.js
+++ b/server/routes/handler.js
@@ -4,6 +4,6 @@ function handle_payment_intent_succeeded(payment) {
   const order = orders.find(payment.metadata.orderId);
   order.status = 'paid';
-  order.paidAt = Date.now();
+  order.paidAt = new Date().toISOString();
   orders.save(order);
   return order;
 }
diff --git a/server/utils/deprecated.js b/server/utils/deprecated.js
deleted file mode 100644
index 7d3e2a1..0000000
--- a/server/utils/deprecated.js
+++ /dev/null
@@ -1,4 +0,0 @@
-// Kept for the v1 API, remove after the migration.
-exports.formatAmount = function (cents) {
-  return '$' + (cents / 100).toFixed(2);
-};
diff --git a/package.json b/package.json
index 1a2b3c4..5d6e7f8 100644
--- a/package.json
+++ b/package.json
@@ -6,7 +6,8 @@
     "start": "node server/index.js",
     "test": "jest"
   },
   "dependencies": {
-    "express": "^4.18.2"
+    "express": "^4.19.2",
+    "stripe": "^14.21.0"
   }
-}
+}
\\ No newline at end of file
diff --git a/public/styles.css b/public/styles.css
index 2c3d4e5..6f7a8b9 100644
--- a/public/styles.css
+++ b/public/styles.css
@@ -12,4 +12,10 @@ body {
 .button {
   padding: 8px 16px;
   border-radius: 4px;
+  background: #635bff;
+  color: #fff;
 }
+
+.button:hover {
+  filter: brightness(1.1);
+}
`;

const PYTHON = `diff --git a/jobs/report.py b/jobs/report.py
index 3e4f5a6..7b8c9d0 100644
--- a/jobs/report.py
+++ b/jobs/report.py
@@ -1,12 +1,67 @@
 import csv
 import smtplib
 from datetime import date, timedelta

 from db import connect

-DB_PASSWORD = os.environ["DB_PASSWORD"]
+DB_PASSWORD = "Summer2024!prod"
+REPORT_RECIPIENTS = ["finance@example.com"]


 def load_orders(day):
     conn = connect(password=DB_PASSWORD)
-    return conn.query("select * from orders where day = %s", day)
+    try:
+        return conn.query("select * from orders where day = %s", day)
+    except:
+        print("query failed")
+        return []
+
+
+def build_report(day):
+    orders = load_orders(day)
+    totals = {}
+    refunds = {}
+    # TODO: move currency conversion into its own module
+    for order in orders:
+        region = order["region"]
+        amount = order["amount"]
+        if order["currency"] == "EUR":
+            amount = amount * 1.08
+        elif order["currency"] == "GBP":
+            amount = amount * 1.27
+        if order["status"] == "refunded":
+            refunds[region] = refunds.get(region, 0) + amount
+            continue
+        totals[region] = totals.get(region, 0) + amount
+
+    rows = []
+    for region, total in sorted(totals.items()):
+        refund = refunds.get(region, 0)
+        net = total - refund
+        flag = ""
+        if net > 250000:
+            flag = "high"
+        elif net < 0:
+            flag = "negative"
+        rows.append([region, round(total, 2), round(refund, 2), round(net, 2), flag])
+
+    path = f"reports/sales-{day.isoformat()}.csv"
+    with open(path, "w", newline="") as handle:
+        writer = csv.writer(handle)
+        writer.writerow(["region", "total", "refunds", "net", "flag"])
+        writer.writerows(rows)
+
+    summary = []
+    for row in rows:
+        summary.append(f"{row[0]}: {row[3]}")
+    body = "; ".join(summary)
+
+    with smtplib.SMTP("smtp.example.com", 587) as smtp:
+        smtp.login("reports", DB_PASSWORD)
+        smtp.sendmail("reports@example.com", REPORT_RECIPIENTS, body)
+    return path
+
+
+async def run_nightly():
+    yesterday = date.today() - timedelta(days=1)
+    return build_report(yesterday)
diff --git a/tests/test_report.py b/tests/test_report.py
new file mode 100644
index 0000000..e5f6a7b
--- /dev/null
+++ b/tests/test_report.py
@@ -0,0 +1,37 @@
+import pytest
+from datetime import date
+
+from jobs.report import build_report
+
+
+def test_build_report_writes_csv(tmp_path, monkeypatch):
+    monkeypatch.chdir(tmp_path)
+    (tmp_path / "reports").mkdir()
+    monkeypatch.setattr("jobs.report.load_orders", lambda day: [
+        {"region": "EU", "amount": 100, "currency": "EUR", "status": "paid"},
+    ])
+    monkeypatch.setattr("jobs.report.smtplib.SMTP", FakeSmtp)
+    path = build_report(date(2026, 1, 31))
+    assert (tmp_path / path).read_text().startswith("region,total")
+
+
+@pytest.mark.skip(reason="flaky on CI")
+def test_refunds_are_subtracted():
+    pass
+
+
+class FakeSmtp:
+    def __init__(self, *args):
+        pass
+
+    def __enter__(self):
+        return self
+
+    def __exit__(self, *exc):
+        return False
+
+    def login(self, *args):
+        pass
+
+    def sendmail(self, *args):
+        pass
`;

export const SAMPLES: SampleDiff[] = [
  {
    id: 'angular',
    title: 'Angular: user directory with search',
    description: 'A new component, template, service change, spec and an image. TypeScript, HTML, binary file.',
    diff: ANGULAR,
  },
  {
    id: 'node',
    title: 'Node.js: Stripe payment webhook',
    description: 'New Express route, config change, a rename, a deleted file, package.json without a final newline and CSS.',
    diff: NODE,
  },
  {
    id: 'python',
    title: 'Python: nightly sales report job',
    description: 'A long reporting function, credentials, exception handling and new pytest tests.',
    diff: PYTHON,
  },
];

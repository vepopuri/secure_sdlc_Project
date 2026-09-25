"""API tests: health, auth, roles, tenancy, engagements, evidence, audit."""

from __future__ import annotations

from conftest import AUTH_SECRET, SAMPLE_EVIDENCE, auth, make_token, run_analysis

from app.services.redaction import EMAIL_TOKEN, PHONE_TOKEN


def test_root_and_health(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok", "version": r.json()["version"]}
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"


def test_cors_preflight_allows_only_configured_origins(client):
    ok = client.options("/api/engagements", headers={
        "Origin": "https://app.example.com", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"})
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "https://app.example.com"
    bad = client.options("/api/engagements", headers={
        "Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_auth_required_and_token_validation(client):
    assert client.get("/api/engagements").status_code == 401
    assert client.get("/api/engagements", headers={"Authorization": "Bearer nope"}).status_code == 401
    bad_sig = make_token("a@b.test", secret="wrong-secret-wrong-secret-wrong-secret")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {bad_sig}"}).status_code == 401
    expired = make_token("a@b.test", iat_offset=-3600)
    r = client.get("/api/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and r.json()["detail"] == "Token expired"
    wrong_aud = make_token("a@b.test", audience="other")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {wrong_aud}"}).status_code == 401
    too_long = make_token("a@b.test", lifetime=24 * 3600)
    assert client.get("/api/me", headers={"Authorization": f"Bearer {too_long}"}).status_code == 401
    assert AUTH_SECRET  # sanity


def test_first_user_gets_personal_org_as_admin(client, alice):
    me = client.get("/api/me", headers=alice).json()
    assert me["email"] == "alice@acme.test"
    assert me["role"] == "admin"
    assert me["organization"]["name"] == "Alice's organization"


def test_invitation_roles_and_viewer_is_read_only(client, alice, engagement):
    r = client.post("/api/org/invitations", headers=alice, json={"email": "Victor@Acme.test", "role": "viewer"})
    assert r.status_code == 201
    victor = auth("victor@acme.test")
    me = client.get("/api/me", headers=victor).json()
    assert me["role"] == "viewer"
    assert me["organization"]["id"] == client.get("/api/me", headers=alice).json()["organization"]["id"]
    # viewers can read ...
    assert client.get(f"/api/engagements/{engagement['id']}", headers=victor).status_code == 200
    # ... but not write
    assert client.post("/api/engagements", headers=victor, json={"client_name": "x", "app_name": "y"}).status_code == 403
    assert client.patch(f"/api/engagements/{engagement['id']}", headers=victor,
                        json={"status": "final"}).status_code == 403
    assert client.post("/api/org/invitations", headers=victor,
                       json={"email": "z@acme.test"}).status_code == 403
    # admin promotes the viewer to assessor
    members = client.get("/api/org/members", headers=alice).json()["members"]
    vid = next(m["id"] for m in members if m["email"] == "victor@acme.test")
    assert client.patch(f"/api/org/members/{vid}", headers=alice, json={"role": "assessor"}).status_code == 200
    assert client.patch(f"/api/engagements/{engagement['id']}", headers=victor,
                        json={"status": "review"}).status_code == 200
    # assessors cannot delete engagements (admin only)
    assert client.delete(f"/api/engagements/{engagement['id']}", headers=victor).status_code == 403


def test_last_admin_cannot_demote_self(client, alice):
    me = client.get("/api/me", headers=alice).json()
    r = client.patch(f"/api/org/members/{me['id']}", headers=alice, json={"role": "viewer"})
    assert r.status_code == 409


def test_engagement_crud_and_audit(client, alice):
    r = client.post("/api/engagements", headers=alice, json={
        "client_name": "  Globex ", "app_name": "Portal", "business_unit": "Retail",
        "frameworks": [{"key": "samm", "target": 99}, {"key": "slsa"}]})
    assert r.status_code == 201
    eng = r.json()
    assert eng["client_name"] == "Globex"
    assert eng["status"] == "draft"
    assert [f["framework_key"] for f in eng["frameworks"]] == ["samm", "slsa"]
    assert eng["frameworks"][0]["target_level"] == 3  # clamped to the SAMM scale
    r = client.patch(f"/api/engagements/{eng['id']}", headers=alice, json={"status": "in_progress"})
    assert r.json()["status"] == "in_progress"
    r = client.patch(f"/api/engagements/{eng['id']}", headers=alice, json={"frameworks": [{"key": "bsimm"}]})
    assert [f["framework_key"] for f in r.json()["frameworks"]] == ["bsimm"]
    assert client.patch(f"/api/engagements/{eng['id']}", headers=alice,
                        json={"status": "done"}).status_code == 422
    assert client.post("/api/engagements", headers=alice, json={
        "client_name": "x", "app_name": "y", "frameworks": [{"key": "nope"}]}).status_code == 422
    assert len(client.get("/api/engagements", headers=alice).json()) == 1
    actions = [a["action"] for a in client.get(f"/api/audit?engagement_id={eng['id']}", headers=alice).json()]
    assert actions == ["engagement.update", "engagement.status", "engagement.create"]
    assert client.delete(f"/api/engagements/{eng['id']}", headers=alice).status_code == 204
    assert client.get(f"/api/engagements/{eng['id']}", headers=alice).status_code == 404


def test_cross_org_access_returns_404(client, alice, mallory, engagement_with_evidence):
    eid = engagement_with_evidence["id"]
    run_analysis(client, alice, eid, "samm")
    docs = client.get(f"/api/engagements/{eid}/documents", headers=alice).json()
    run = client.get(f"/api/engagements/{eid}/analysis/runs", headers=alice).json()[0]
    tpl = client.post("/api/templates", headers=alice, files={
        "file": ("t.pptx", client.get("/api/templates/sample", headers=alice).content)}).json()
    probes = [
        ("get", f"/api/engagements/{eid}", None),
        ("patch", f"/api/engagements/{eid}", {"status": "final"}),
        ("delete", f"/api/engagements/{eid}", None),
        ("get", f"/api/engagements/{eid}/documents", None),
        ("get", f"/api/engagements/{eid}/documents/{docs[0]['id']}", None),
        ("delete", f"/api/engagements/{eid}/documents/{docs[0]['id']}", None),
        ("get", f"/api/engagements/{eid}/search?q=threat", None),
        ("post", f"/api/engagements/{eid}/interviews", {"title": "x", "notes": "y"}),
        ("post", f"/api/engagements/{eid}/analysis/runs", {"framework_key": "samm"}),
        ("post", f"/api/engagements/{eid}/analysis/runs/{run['id']}/domains/G", None),
        ("get", f"/api/engagements/{eid}/results/samm", None),
        ("put", f"/api/engagements/{eid}/overrides/samm/G-SM", {"score": 3, "reason": "pwned"}),
        ("get", f"/api/engagements/{eid}/report", None),
        ("get", f"/api/engagements/{eid}/report?template_id={tpl['id']}", None),
        ("get", f"/api/audit?engagement_id={eid}", None),
        ("delete", f"/api/templates/{tpl['id']}", None),
    ]
    for method, url, body in probes:
        kwargs = {"headers": mallory}
        if body is not None:
            kwargs["json"] = body
        r = getattr(client, method)(url, **kwargs)
        assert r.status_code == 404, (method, url, r.status_code)
    assert client.get("/api/engagements", headers=mallory).json() == []
    assert client.get("/api/templates", headers=mallory).json() == []
    assert all(a["user_email"] != "alice@acme.test" for a in client.get("/api/audit", headers=mallory).json())
    # alice's data is untouched
    assert client.get(f"/api/engagements/{eid}", headers=alice).json()["status"] == "in_progress"


def test_upload_parse_redact_and_search(client, alice, engagement_with_evidence):
    eid = engagement_with_evidence["id"]
    docs = client.get(f"/api/engagements/{eid}/documents", headers=alice).json()
    assert [d["kind"] for d in docs] == ["file", "interview"]
    assert docs[0]["chunk_count"] >= 1
    interview = client.get(f"/api/engagements/{eid}/documents/{docs[1]['id']}", headers=alice).json()
    assert "dev.lead@acme.test" not in interview["text"]
    assert EMAIL_TOKEN in interview["text"] and PHONE_TOKEN in interview["text"]
    assert interview["redactions"] == 2
    assert interview["interviewee_role"] == "Lead developer"
    hits = client.get(f"/api/engagements/{eid}/search?q=threat modeling", headers=alice).json()
    assert hits and "Design" in hits[0]["heading"]
    assert "<<" in hits[0]["snippet"]
    eng = client.get(f"/api/engagements/{eid}", headers=alice).json()
    assert eng["document_count"] == 1 and eng["interview_count"] == 1


def test_upload_validation(client, alice, engagement, monkeypatch):
    eid = engagement["id"]
    url = f"/api/engagements/{eid}/documents"
    r = client.post(url, headers=alice, files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 415
    r = client.post(url, headers=alice, files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert r.status_code == 415
    r = client.post(url, headers=alice, files={"file": ("a.md", SAMPLE_EVIDENCE.encode(), "text/markdown")})
    assert r.status_code == 201
    r = client.post(url, headers=alice, files={"file": ("copy.md", SAMPLE_EVIDENCE.encode(), "text/markdown")})
    assert r.status_code == 409
    monkeypatch.setenv("MAX_DIRECT_UPLOAD_MB", "0.001")
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        r = client.post(url, headers=alice, files={"file": ("big.txt", b"x" * 5000, "text/plain")})
        assert r.status_code == 413
    finally:
        monkeypatch.delenv("MAX_DIRECT_UPLOAD_MB")
        get_settings.cache_clear()


def test_blob_ingest_enforces_allow_list_and_fetches(client, alice, engagement, monkeypatch):
    eid = engagement["id"]
    r = client.post(f"/api/engagements/{eid}/documents/from-blob", headers=alice,
                    json={"url": "https://169.254.169.254/latest/meta-data", "filename": "x.md"})
    assert r.status_code == 400
    import app.routers.evidence as ev

    seen = {}

    def fake_fetch(url, suffixes, max_bytes):
        seen["url"] = url
        from app.services.blob import validate_blob_url

        validate_blob_url(url, suffixes)
        return b"# Big file\n\nPenetration testing happens annually."

    monkeypatch.setattr(ev, "fetch_blob", fake_fetch)
    r = client.post(f"/api/engagements/{eid}/documents/from-blob", headers=alice, json={
        "url": "https://abc.public.blob.vercel-storage.com/big-file-x1y2.md", "filename": "big-file.md"})
    assert r.status_code == 201, r.text
    assert r.json()["filename"] == "big-file.md"


def test_interview_update_and_delete(client, alice, engagement):
    eid = engagement["id"]
    r = client.post(f"/api/engagements/{eid}/interviews", headers=alice, json={
        "title": "CISO", "interviewee_role": "CISO", "notes": "We have a security strategy."})
    doc = r.json()
    r = client.put(f"/api/engagements/{eid}/interviews/{doc['id']}", headers=alice, json={
        "title": "CISO interview", "interviewee_role": "CISO", "notes": "Phone 555-123-4567. Updated notes."})
    assert r.status_code == 200 and r.json()["redactions"] == 1
    full = client.get(f"/api/engagements/{eid}/documents/{doc['id']}", headers=alice).json()
    assert "Updated notes" in full["text"] and len(full["chunks"]) == 1
    assert client.delete(f"/api/engagements/{eid}/documents/{doc['id']}", headers=alice).status_code == 204
    assert client.get(f"/api/engagements/{eid}/documents", headers=alice).json() == []


def test_frameworks_catalogue(client, alice):
    fws = client.get("/api/frameworks", headers=alice).json()
    assert [f["key"] for f in fws] == ["nist_csf", "samm", "nist_ssdf", "bsimm", "owasp_asvs", "slsa", "iso_27034"]
    iso = client.get("/api/frameworks/iso_27034", headers=alice).json()
    assert "copyright" in iso["license_note"].lower()
    assert len(client.get("/api/capabilities", headers=alice).json()) >= 28

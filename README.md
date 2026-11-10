# pintu-naik-academic-profile
Academic profile website for Pintu Naik, PhD scholar in Computer Science and Engineering at IIT Jammu.

A professional personal website organized with separate frontend and backend code.

## Project Structure

```text
frontend/
  index.html              Profile homepage
  research.html           Research interests
  publications.html       Publications list
  projects.html           Research and software projects
  teaching.html           Teaching and mentoring
  achievements.html       Awards, certificates, and photo gallery
  education.html          Education history
  cv.html                 Academic CV
  admin.html              Local, password-protected content editor
  styles.css              Frontend design and responsive layout
  script.js               Browser behavior and JSON content loading
  admin.js                Admin editor behavior
  assets/
    research-graph-computing.jpg
    research-nanopore-lab.jpg
    research-distributed-systems.jpg
    profile-publications.jpg
    profile-projects.jpg
    profile-teaching.jpg
    profile-achievements.jpg
    profile-education.jpg
    profile-cv.jpg

backend/
  server.js               Node.js HTTP server and API routes
  data/
    profile.json          Name, title, contact links, summary, about text
    research.json         Research interests
    updates.json          Homepage news and recent updates
    publications.json     Publication list
    projects.json         Project cards
    achievements.json     Achievement cards with image paths
    education.json        Education history
    skills.json           Technical strengths
    teaching.json         Teaching and mentoring history

package.json              Project scripts
README.md                 Project documentation
```

## Run

Start the backend server:

```bash
npm start
```

Open the website:

```text
http://localhost:3000
```

For development, this command does the same thing:

```bash
npm run dev
```

Check JavaScript syntax:

```bash
npm run check
```

## Publish on GitHub Pages

GitHub Pages serves static files and does not run the Node.js backend. This
repository includes a GitHub Actions workflow that publishes the frontend and
its JSON content files whenever you push to the `main` or `master` branch.

1. Push this project to a public GitHub repository.
2. In the repository, open **Settings → Pages** and set the build and
   deployment source to **GitHub Actions**.
3. Push to `main` or `master`, or start **Deploy website to GitHub Pages**
   from the **Actions** tab.
4. Open the published URL shown by the workflow.

The public site reads its content from `backend/data/` as static JSON files.
The deployment workflow copies those files alongside the frontend. The Node
backend and password-protected admin editor are for local use and are not
deployed to GitHub Pages. To update the public site, edit the relevant JSON
file, then commit and push the change.

## Admin Editor

The browser editor is available when you run the Node backend locally. It is
not included in the GitHub Pages deployment.

Start the server with an admin password:

```bash
ADMIN_PASSWORD="change-this-password" npm start
```

Then open:

```text
http://localhost:3000/admin.html
```

Browser login:

```text
Username: admin
Password: the ADMIN_PASSWORD value you used
```

You can also choose a custom username:

```bash
ADMIN_USER="yourname" ADMIN_PASSWORD="change-this-password" npm start
```

## Customize

For local development, use the protected admin editor or edit the relevant
data file directly. To change the published site, edit the data file and push
the change to GitHub:

```bash
backend/data/profile.json
backend/data/research.json
backend/data/publications.json
backend/data/projects.json
backend/data/achievements.json
backend/data/education.json
```

In VS Code, open the file from the left sidebar and change the text directly.

### Visitor statistics by country (Google Analytics 4)

The public pages include an optional Google Analytics 4 integration. To enable it:

1. Create a Google Analytics account and a GA4 property for your public website.
2. Create a **Web** data stream for the published site and copy its Measurement ID
   (format: `G-XXXXXXXXXX`).
3. Replace `G-XXXXXXXXXX` in `frontend/analytics.js` with your Measurement ID.
4. Commit and push the change to publish it. The placeholder does not send analytics
   requests until replaced with a valid ID.
5. In Google Analytics, open **Reports → User → Demographic details** and select
   **Country** to see visitors by country. Reports can take up to 24–48 hours to
   populate.

The Measurement ID is public configuration, not a password. Add an appropriate
privacy notice to your site and follow applicable consent and privacy requirements
for your visitors before enabling analytics.

Review the profile, publication, project, education, and contact details in
the JSON files before making the repository public.

The homepage Research themes photos are downloaded from Unsplash and stored
locally for reliable static hosting. Photo sources: [computer hardware](https://images.unsplash.com/photo-1518770660439-4636190af475),
[sequencing laboratory](https://images.unsplash.com/photo-1579154204601-01588f351e67),
and [server room](https://images.unsplash.com/photo-1558494949-ef010cbdcc31).
They are used under the [Unsplash License](https://unsplash.com/license).
The homepage Explore my profile cards also use local Unsplash photos: [publications](https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8),
[projects](https://images.unsplash.com/photo-1519389950473-47ba0277781c),
[teaching](https://images.unsplash.com/photo-1509062522246-3755977927d7),
[academic milestones](https://images.unsplash.com/photo-1523580494863-6f3031224c94),
[education](https://images.unsplash.com/photo-1524995997946-a1c2e315a42f),
and [CV writing](https://images.unsplash.com/photo-1455390582262-044cdead277a).

Education entries can include an `institution` and an `institutionLogo` path in
`backend/data/education.json`. Keep logo files in `frontend/assets/institutes/`;
the Education and CV pages use these local assets.

Publication entries in `backend/data/publications.json` support `title`,
`authors`, `venue`, `year`, `type` (`conference`, `journal`, or `bookChapter`),
`url`, `doi`, and `pdf`. The Publications page groups entries by type and has a
year-order toggle. Use `status` for an accepted paper whose publication details
are not final; do not guess a title or author list.

### Achievements and photos

Add achievement entries in the protected admin editor or
`backend/data/achievements.json`. Put image files in `frontend/assets/` and use
paths such as `assets/award-photo.jpg`. Set `category` to group photos under
headings such as `Achievements`, `Fun & Memories`, or `Travel & Outdoors`. Each
entry can also include `title`, `date`, `issuer`, `description`, `details`,
`image`, `alt`, and an optional `url`.
View the gallery at `/achievements.html`.

## Backend API

```bash
http://localhost:3000/api/health
http://localhost:3000/api/profile
http://localhost:3000/api/research
http://localhost:3000/api/updates
http://localhost:3000/api/publications
http://localhost:3000/api/projects
http://localhost:3000/api/achievements
http://localhost:3000/api/education
http://localhost:3000/api/skills
http://localhost:3000/api/teaching
```

Protected admin API:

```bash
http://localhost:3000/api/admin/site-data
```

## Standard Workflow

Edit academic content in the matching file inside `backend/data/`.

For achievement photos, put image files in `frontend/assets/` and use paths like
`assets/award-photo.jpg` inside the `achievements` list.

For your header profile photo, put an image in `frontend/assets/` and set
`photo` in `backend/data/profile.json`, for example `assets/profile-photo.jpg`.

Edit layout/content structure in `frontend/index.html` and `frontend/cv.html`.

Edit design in `frontend/styles.css`.

Edit browser behavior in `frontend/script.js`.

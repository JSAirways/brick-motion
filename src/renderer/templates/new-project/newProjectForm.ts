import { captureModeLabel } from "../../utils/captureModeLabel";

export const renderNewProjectForm = (): string => `
  <main class="container-fluid min-vh-100 d-flex align-items-center justify-content-center bm-page">
    <section class="bm-panel shadow-lg p-4 p-lg-5">
      <header class="mb-4">
        <h1 class="bm-panel-title mb-1">New Brick-Motion Project</h1>
        <p class="bm-panel-subtitle mb-0">Set core project defaults before entering capture workspace.</p>
      </header>

      <form id="newProjectForm" class="vstack gap-3">
        <div>
          <label for="projectTitle" class="form-label">Project title</label>
          <input id="projectTitle" name="title" class="form-control" type="text" placeholder="My Stopmotion Scene" required />
        </div>

        <div>
          <label for="captureMode" class="form-label">Capture mode</label>
          <select id="captureMode" name="captureMode" class="form-select">
            <option value="jpeg">${captureModeLabel("jpeg")}</option>
            <option value="png">${captureModeLabel("png")}</option>
          </select>
        </div>

        <div>
          <label for="fps" class="form-label">Framerate</label>
          <input id="fps" name="fps" class="form-control" type="number" min="1" max="60" value="12" required />
        </div>

        <div>
          <label for="sourcePath" class="form-label">Project folder</label>
          <div class="input-group">
            <input id="sourcePath" name="sourcePath" class="form-control" type="text" placeholder="Select project path..." readonly required />
            <button type="button" class="btn btn-outline-secondary" data-action="pick-source-path">
              <i class="bi bi-folder2-open"></i>
            </button>
          </div>
        </div>

        <div class="d-flex justify-content-end gap-2 pt-2">
          <button type="button" class="btn btn-outline-secondary" data-action="cancel-new-project">Cancel</button>
          <button type="submit" class="btn btn-primary">Create Project</button>
        </div>
      </form>
    </section>
  </main>
`;

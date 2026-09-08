package bospa

import (
	"net/http"
)

func (api *API) handleListApartments(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	apartments, err := api.store.ListApartments(r.Context(), principal.WorkspaceID)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": apartments})
}

func (api *API) handleCreateApartment(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input CreateApartmentInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	apartment, err := api.store.CreateApartment(r.Context(), principal.WorkspaceID, principal.ID, input)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, apartment)
}

func (api *API) handleListApplications(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	filter, err := applicationFilter(r, principal.Workspace.Timezone)
	if err != nil {
		writeAPIError(w, r, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	applications, err := api.store.ListApplications(r.Context(), principal.WorkspaceID, filter)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": applications, "limit": filter.Limit, "offset": filter.Offset})
}

func (api *API) handleCreateApplication(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input CreateApplicationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if input.External && !input.IsTest && principal.Role != RoleSuperadmin {
		writeAPIError(w, r, http.StatusForbidden, "forbidden", "Реальные внешние заявки создаются только provider adapter.")
		return
	}
	if input.Status == StatusTechnical && principal.Role != RoleOwner && principal.Role != RoleSuperadmin {
		writeAPIError(w, r, http.StatusForbidden, "forbidden", "Техническую блокировку создаёт владелец.")
		return
	}
	application, err := api.store.CreateApplication(r.Context(), *principal, input)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, application)
}

func (api *API) handleGetApplication(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	detail, err := api.store.GetApplicationDetail(r.Context(), principal.WorkspaceID, r.PathValue("id"))
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (api *API) handleUpdateApplication(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input UpdateApplicationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	application, err := api.store.UpdateApplication(r.Context(), *principal, r.PathValue("id"), input)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, application)
}

func (api *API) handleClaimApplication(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	application, err := api.store.ClaimApplication(r.Context(), *principal, r.PathValue("id"))
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, application)
}

type statusRequest struct {
	Status      ApplicationStatus `json:"status"`
	LockVersion int64             `json:"lockVersion"`
}

func (api *API) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input statusRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	application, err := api.store.UpdateApplicationStatus(r.Context(), *principal, r.PathValue("id"), input.Status, input.LockVersion)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, application)
}

type commentRequest struct {
	Text string `json:"text"`
}

func (api *API) handleAddContact(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input CreateContactInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	event, err := api.store.AddContactEvent(r.Context(), *principal, r.PathValue("id"), input)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, event)
}

func (api *API) handleAddComment(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input commentRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	comment, err := api.store.AddComment(r.Context(), *principal, r.PathValue("id"), input.Text)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, comment)
}

func (api *API) handleAddPayment(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input CreatePaymentInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	payment, application, err := api.store.AddPayment(r.Context(), *principal, r.PathValue("id"), input)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"payment": payment, "application": application})
}

func (api *API) handleAddRefund(w http.ResponseWriter, r *http.Request) {
	principal := mustPrincipal(r.Context())
	var input CreateRefundInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeAPIError(w, r, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	payment, application, err := api.store.AddRefund(r.Context(), *principal, r.PathValue("id"), input)
	if err != nil {
		api.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"refund": payment, "application": application})
}

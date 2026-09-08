package bospa

import "testing"

func TestValidateTransition(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		from    ApplicationStatus
		to      ApplicationStatus
		wantErr bool
	}{
		{name: "new to awaiting prepayment", from: StatusNew, to: StatusAwaitingPrepay},
		{name: "awaiting to prepaid", from: StatusAwaitingPrepay, to: StatusPrepaid},
		{name: "prepaid to paid", from: StatusPrepaid, to: StatusPaid},
		{name: "paid to completed", from: StatusPaid, to: StatusCompleted},
		{name: "new cannot become paid directly", from: StatusNew, to: StatusPaid, wantErr: true},
		{name: "manager cannot set system duplicate", from: StatusNew, to: StatusDuplicate, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateTransition(test.from, test.to)
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateTransition(%q, %q) error = %v, wantErr %v", test.from, test.to, err, test.wantErr)
			}
		})
	}
}

func TestHardStatuses(t *testing.T) {
	t.Parallel()
	for _, status := range []ApplicationStatus{StatusPrepaid, StatusPaid, StatusTechnical} {
		if !status.IsHard() {
			t.Fatalf("expected %q to be hard", status)
		}
	}
	if StatusNew.IsHard() {
		t.Fatal("new application must stay soft")
	}
}

func TestCreateContactInputValidation(t *testing.T) {
	t.Parallel()

	callback := CreateContactInput{Outcome: ContactCallback}
	if err := callback.Validate(); err == nil {
		t.Fatal("callback contact must require callbackAt")
	}

	valid := CreateContactInput{Outcome: ContactReached, Note: "Клиент подтвердил даты"}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid contact rejected: %v", err)
	}

	invalid := CreateContactInput{Outcome: ContactOutcome("unknown")}
	if err := invalid.Validate(); err == nil {
		t.Fatal("unknown contact outcome must be rejected")
	}
}

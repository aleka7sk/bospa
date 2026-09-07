package bospa

import "testing"

func TestStatusTransitions(t *testing.T) {
	t.Parallel()
	valid := [][2]Status{{StatusNew, StatusAwaitingPrepay}, {StatusAwaitingPrepay, StatusPrepaid}, {StatusPrepaid, StatusPaid}, {StatusPaid, StatusCompleted}}
	for _, pair := range valid {
		if err := ValidateTransition(pair[0], pair[1]); err != nil {
			t.Fatalf("expected %s -> %s to be valid: %v", pair[0], pair[1], err)
		}
	}
	invalid := [][2]Status{{StatusNew, StatusPaid}, {StatusNew, StatusDuplicate}, {StatusCompleted, StatusNew}}
	for _, pair := range invalid {
		if err := ValidateTransition(pair[0], pair[1]); err == nil {
			t.Fatalf("expected %s -> %s to be invalid", pair[0], pair[1])
		}
	}
}

func TestHardStatuses(t *testing.T) {
	t.Parallel()
	for _, status := range []Status{StatusPrepaid, StatusPaid, StatusTechnical} {
		if !status.Hard() {
			t.Fatalf("expected %s to be hard", status)
		}
	}
	if StatusNew.Hard() {
		t.Fatal("new application must stay soft")
	}
}

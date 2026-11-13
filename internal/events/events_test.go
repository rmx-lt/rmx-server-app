package events

import "testing"

func TestBusDeliversInOrderToEverySubscriber(t *testing.T) {
	b := New[int]()
	x, y := b.Subscribe(), b.Subscribe()
	b.Publish(1)
	b.Publish(2)
	for _, s := range []*Subscription[int]{x, y} {
		if <-s.C != 1 || <-s.C != 2 {
			t.Fatal("events out of order")
		}
	}
	x.Close()
	x.Close() // harmless
	if _, open := <-x.C; open {
		t.Fatal("a closed subscription still delivers")
	}
	b.Publish(3)
	if <-y.C != 3 {
		t.Fatal("the other subscriber missed an event")
	}
	if x.Lagged() {
		t.Fatal("closing is not lagging")
	}
}

func TestBusDropsSlowSubscribers(t *testing.T) {
	b := NewWithBuffer[int](4)
	slow := b.Subscribe()
	for i := range 5 {
		b.Publish(i)
	}
	// What was buffered is still delivered, then the channel closes.
	n := 0
	for range slow.C {
		n++
	}
	if n != 4 || !slow.Lagged() {
		t.Fatalf("delivered %d events, lagged=%v", n, slow.Lagged())
	}
	// Publishing never blocks, even with nobody left.
	b.Publish(0)
	slow.Close()
}
